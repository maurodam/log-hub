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

## 5. Security checklist

- HTTPS only; HSTS is sent automatically outside Development.
- Change the first administrator password at first sign-in; create named accounts, disable `admin` if not needed.
- Give applications API keys with the `Ingest` permission only. Use a separate key per application: its *applied properties* tag every event (for example `App=Billing`) and it can be revoked alone.
- Configure a retention policy (*Settings → Retention*) so the database does not grow forever.
- Set `DataProtection__KeyVaultKeyUri`: without it the key ring that protects sessions and the stored SMTP password sits unencrypted in the database (LogHub logs a warning).
- Set `Alerts__AllowedRecipientDomains__0` to your mail domain so alerts cannot send log data outside the organization.
- Session cookies are `HttpOnly`, `Secure`, `SameSite=Strict`, idle timeout 8 h, absolute lifetime 7 days; state-changing requests need the CSRF token; logins are rate limited per IP; 5 failures block that IP for the account, 25 lock the account.
