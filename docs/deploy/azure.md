# Deploy LogHub on Azure

Recommended setup:

| Component | Azure service |
|---|---|
| LogHub container | Azure Container Apps (HTTPS ingress, managed identity) |
| Database | Azure Database for PostgreSQL – Flexible Server (PostgreSQL 17) |
| Secrets | Azure Key Vault (connection string, admin password, SMTP password, OIDC secret) |
| Sign-in | Microsoft Entra ID (OpenID Connect), local accounts as fallback |
| Image | Azure Container Registry or GitHub Container Registry |

## 1. Database

1. Create a Flexible Server (PostgreSQL 17), enable `pg_trgm` in *Server parameters → azure.extensions*.
2. Create database `loghub` and a login for the app.
3. Allow access only from the Container Apps environment (VNet integration or firewall rule).
4. Connection string: `Host=<server>.postgres.database.azure.com;Database=loghub;Username=<user>;Password=<secret>;SSL Mode=Require`.

LogHub creates its tables on startup (DbUp, `Database:MigrateOnStartup`). Replicas starting together are serialized with a PostgreSQL advisory lock.

## 2. Container App

Environment variables (secrets as Key Vault references):

| Variable | Value |
|---|---|
| `ConnectionStrings__LogHub` | connection string (secret) |
| `Auth__AdminPassword` | first administrator password, at least 12 characters (secret; required on the first start, used only when no account exists) |
| `Retention__DefaultDays` | e.g. `180`: events older than that are deleted |
| `Proxy__TrustForwardedHeaders` | `true` (the ingress terminates TLS and sets `X-Forwarded-*`) |
| `DataProtection__KeyVaultKeyUri` | `https://<vault>.vault.azure.net/keys/loghub-dataprotection` (optional, encrypts the key ring) |
| `Ingestion__RequireApiKey` | `true` (default) |

- Ingress: external, HTTPS only, target port `8080`.
- Identity: system-assigned managed identity with *Key Vault Secrets User* (and *Key Vault Crypto User* for the Data Protection key).
- Replicas: minimum 1. Several replicas are fine: sessions use the shared key ring in PostgreSQL, and the retention and alert jobs take an advisory lock so only one replica runs them.
- Health probe: `GET /health`.

## 3. Microsoft Entra ID sign-in (optional)

1. App registration, single tenant. Redirect URI (Web): `https://<loghub-host>/signin-oidc`.
2. Client secret (store it in Key Vault).
3. Variables:

| Variable | Value |
|---|---|
| `Auth__Oidc__Authority` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `Auth__Oidc__ClientId` | application (client) id |
| `Auth__Oidc__ClientSecret` | secret |
| `Auth__Oidc__DisplayName` | `Microsoft` (button text) |
| `Auth__Oidc__AutoProvision` | `false`: only users created in LogHub (provider *Oidc*, username = UPN) can sign in; `true`: everyone in the tenant gets the role in `Auth__Oidc__DefaultRole` |
| `Auth__Oidc__AllowedTenants__0` | your tenant id (required if the authority is `common`/`organizations`; checked against the token `tid`) |

Use a single-tenant authority: LogHub matches pre-created users by `preferred_username`, which the tenant controls. Local accounts are never linked to Entra identities automatically.

## 4. Email alerts

Configure SMTP in *Settings → Email*, or with variables (they override the UI): `Smtp__Host`, `Smtp__Port`, `Smtp__Security` (`StartTls`), `Smtp__Username`, `Smtp__Password`, `Smtp__FromAddress`, `Smtp__PublicUrl` (`https://<loghub-host>`, used for links in emails). Azure Communication Services Email, Microsoft 365 and SendGrid all provide SMTP endpoints.

## 5. Webhook alerts

1. Set `DataProtection__KeyVaultKeyUri` and grant the existing managed identity access to the key.
2. Set `Webhooks__PublicUrl` to the HTTPS address of LogHub. Set `Webhooks__AllowedGenericHosts__0` and further indexed values to the exact hostnames of approved generic receivers. Use `Webhooks__AllowedTeamsHosts__0` only when an explicitly trusted Teams tenant uses a host outside the built-in Azure Logic Apps and Power Platform suffixes.
3. In Teams Workflows, create a flow that posts to the intended channel on webhook receipt, choose the `Anyone` trigger mode where tenant policy allows it, and assign a co-owner. In Slack, install the app's Incoming Webhook in the intended channel. Treat both URLs as credentials.
4. Add each destination under **Settings → Webhooks**, attach it to a pilot alert and run a test from the alert card. Check the notification history and confirm the message appears in each channel. A Teams workflow can accept a request and fail later while posting the card.
5. Review failed deliveries and backlog. Run the following query on the LogHub database for a queue snapshot.

```sql
select count(*) filter (where status = 'Pending') as pending,
       now() - min(created_at) filter (where status = 'Pending') as oldest_pending_age,
       count(*) filter (where status = 'Failed' and created_at >= now() - interval '24 hours') as failures_24h
from webhook_delivery;
```

## 6. Search index rollout

The exception trigram index is included in the database migration. For a populated database, enumerate the leaves with `pg_partition_tree('event')` and run `CREATE INDEX CONCURRENTLY <unique_index_name> ON <leaf> USING gin (exception gin_trgm_ops)` for every leaf, including `event_default`, before deploying the new image. Run each statement separately, outside a transaction. Check `pg_index.indisvalid`, rebuild invalid indexes, and recheck for newly created partitions immediately before the migration. The parent migration attaches equivalent indexes. Schedule a maintenance window if any sizable partition still needs an index.

A local PostgreSQL 17 benchmark used 1.05 million synthetic events across seven daily partitions and ten measured runs per case. For a rare exception over seven days, search p95 went from 1,736 ms to 22 ms. The common and short terms stayed under 3 ms across the seven-day window. The additional index occupied 25 MB. These figures describe the synthetic dataset and query used for the benchmark.

In staging, record `EXPLAIN (ANALYZE, BUFFERS)` before and after for exception terms that are common, selective and short over 24 hours and seven days. Use representative data and compare search p95, ingestion p95, accepted events per second and total index bytes.

## 7. Cost estimate

Public retail pricing checked on 24 November 2026. Example for West Europe, 730 hours per month, pay as you go, before tax.

| Component | Assumption | Monthly estimate |
|---|---|---:|
| PostgreSQL Flexible Server | Burstable B1ms at €0.0179/h and 32 GiB SSD at €0.1229/GiB | €17.00 |
| Container Apps Consumption | One replica at 0.5 vCPU and 1 GiB. Subscription free grant available. Up to two million requests. | ≈ €12–43 |
| Subtotal | PostgreSQL, disk and one replica | **≈ €29–60** |

The Container Apps range spans all-idle and all-active billing. The public EUR API rounds the per-second rates to zero at its displayed precision. This calculation uses the same-region USD meters ($0.000034 active vCPU-second, $0.000004 idle vCPU-second and $0.000004 per GiB-second) converted by the same-region request meter ratio (€0.5027/$0.56). Budget separately for backup over the included allowance, Key Vault, telemetry, network traffic and extra replicas. Check actual active seconds and DB CPU credits during the pilot. For sustained load, quote General Purpose using the measured throughput and retention window.

Seq lists Individual at $0/year for one user and 50 GB, Team at $1,090/year for up to ten users and 100 GB, and Standard at $2,990/year with unlimited users and storage. Include Seq hosting and request an EUR quote for a like-for-like annual comparison. [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), [Azure Pricing Calculator](https://azure.microsoft.com/en-us/pricing/calculator/), [Seq pricing](https://datalust.co/Pricing).

## 8. Security checklist

- HTTPS only; HSTS is sent automatically outside Development.
- Change the first administrator password at first sign-in; create named accounts, disable `admin` if not needed.
- Give applications API keys with the `Ingest` permission only. Use a separate key per application: its *applied properties* tag every event (for example `App=Billing`) and it can be revoked alone.
- Configure a retention policy (*Settings → Retention*) so the database does not grow forever.
- Set `DataProtection__KeyVaultKeyUri`: without it the key ring that protects sessions and the stored SMTP password sits unencrypted in the database (LogHub logs a warning).
- Set `Alerts__AllowedRecipientDomains__0` to your mail domain so alerts cannot send log data outside the organization.
- Session cookies are `HttpOnly`, `Secure`, `SameSite=Strict`, idle timeout 8 h, absolute lifetime 7 days; state-changing requests need the CSRF token; logins are rate limited per IP; 5 failures block that IP for the account, 25 lock the account.
