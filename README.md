# LogHub

[![CI](https://github.com/maurodam/log-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/maurodam/log-hub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Self-hosted structured log server with a **Seq-compatible ingestion endpoint**.
Applications that already log with `Serilog.Sinks.Seq` switch to LogHub by changing the server URL only.

> Status: early development. API reference: [docs/api/v1.md](docs/api/v1.md). Deployment guides: [self-hosted server](docs/deploy/self-hosted.md), [Azure](docs/deploy/azure.md).

## Why

At work, my team needed an internal log portal: one place where our .NET applications send structured logs and where developers can search them, follow them live and get an email when something goes wrong.

Our applications already used Serilog, so the portal had to accept logs from `Serilog.Sinks.Seq` without code changes. It also had to run on infrastructure we control (one Docker image plus PostgreSQL) and keep only the data we need through retention rules.

I built LogHub with the help of LLM coding assistants. I designed the whole structure (architecture, database schema, security model, feature scope) and explained to the LLM how to implement each part. Every feature is checked by unit and integration tests against a real PostgreSQL and the real Serilog sink. The project also served as an experiment in how far an LLM-assisted workflow can go on a full-stack application with production concerns: authentication, data retention, partitioning, CI and deployment.

## Features

- **Seq-compatible ingestion** for `Serilog.Sinks.Seq` and other CLEF clients, with per-key minimum level (dynamic level control) and applied properties.
- **Events**: search by text, level, time range, properties, API key, exceptions, trace and event type; live tail; inline event detail.
- **Signals**: saved filters in a side panel (same group = OR, different groups = AND), personal or shared.
- **Dashboard**: event volume over time, levels, top event types and top API keys for any time range and filter.
- **Retention**: delete events older than N days, for all events (drops whole daily partitions) or per signal.
- **Email alerts**: "at least N matching events in M minutes" rules, SMTP settings, notification history.
- **Security**: local accounts and Microsoft Entra ID (OpenID Connect), roles and permissions, API keys, secure session cookies, CSRF protection, login rate limiting and lockout, security headers.
- **Runs anywhere**: one Docker image plus PostgreSQL; Docker Compose or Azure Container Apps.

## Stack

| Layer | Technology |
|---|---|
| Backend | .NET 10, ASP.NET Core Minimal API, Dapper, DbUp, Serilog |
| Database | PostgreSQL 17 |
| Frontend | Angular 22, Tailwind CSS 4, spartan.ng |
| Delivery | Single Docker image (API + static frontend) |

The code is organized by feature (vertical slices): each feature folder holds its endpoints, SQL and models.

## Quick start (Docker)

```bash
cp .env.example .env    # then set POSTGRES_PASSWORD and the connection string password
docker compose up --build
```

LogHub listens on http://localhost:8080 (`LOGHUB_PORT` in `.env`). Sign in as `admin` with `Auth__AdminPassword` from `.env` (required on the first start; the example value is refused).

For anything reachable from the network, put LogHub behind HTTPS (reverse proxy or a cloud ingress): session cookies are `Secure`.

## Self-hosting on a server

[`docker-compose.prod.yml`](docker-compose.prod.yml) runs the published image with PostgreSQL and [Caddy](Caddyfile) (automatic Let's Encrypt HTTPS). On the server you need only that file, `Caddyfile` and `.env`:

```bash
# .env: set POSTGRES_PASSWORD, Auth__AdminPassword, LOGHUB_DOMAIN (DNS pointing to the server)
docker compose -f docker-compose.prod.yml up -d
```

Full guide (backups, upgrades, key ring encryption, nginx or an existing proxy): [docs/deploy/self-hosted.md](docs/deploy/self-hosted.md).

## Send logs from a .NET application

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.Seq("http://localhost:8080", apiKey: "<your LogHub API key>")
    .CreateLogger();
```

Ingestion endpoints (wire-compatible with `Serilog.Sinks.Seq` and other Seq clients):

| Endpoint | Payload |
|---|---|
| `POST /api/events/raw` | newline-delimited CLEF (`application/vnd.serilog.clef`), a single CLEF object, or legacy `{"Events":[...]}` |
| `POST /ingest/clef` | same as above |

- API key in the `X-Seq-ApiKey` header or the `?apiKey=` query parameter.
- `201 {"MinimumLevelAccepted":null}` on success. When the API key has a minimum level, LogHub drops lower events and returns the level, so the Serilog sink lowers its own level without a redeploy.
- `400` invalid payload, `401` missing or unknown key, `403` key without `Ingest` permission, `413` payload too large, `503` server busy (the sink retries).
- Properties applied by the API key (for example `{"App":"Billing"}`) are added to every event.

Create API keys in *Settings → API Keys*: the token is shown once, with ready-to-paste snippets. Give each application its own key with the `Ingest` permission and an applied property such as `App=Billing`.

In the `Development` environment an API key is not required for ingestion (`Ingestion:RequireApiKey`).

## Read events (REST API)

`/api/v1` endpoints accept a browser session (the LogHub UI) or an API key in the `X-Api-Key` header with the needed permission. Full reference: [docs/api/v1.md](docs/api/v1.md).

| Endpoint | Description |
|---|---|
| `GET /api/v1/events` | newest first; filters `text`, `levels`, `from`, `to`, `traceId`, `eventType`, `property=Name=Value`, `apiKeys`, `hasException`, `signals`; paging with `count` (max 1000) and `nextCursor` |
| `GET /api/v1/events/{id}` | one event |
| `GET /api/v1/events/stream` | live tail over Server-Sent Events (same filters); resumes after `Last-Event-ID` |
| `GET /api/v1/stats/overview` | dashboard aggregates |

```bash
curl -H "X-Api-Key: <key>" "http://localhost:8080/api/v1/events?levels=Error,Fatal&property=App=Billing&count=50"
```

## Local development

Prerequisites: .NET SDK 10, Node.js 24, Docker.

```bash
docker compose up -d db               # PostgreSQL only
dotnet run --project src/LogHub.Api   # API on http://localhost:5080, migrates the database on startup
cd web && npm install && npm start    # Angular on http://localhost:4200, proxies /api to the API
```

In the `Development` environment the API reads `.env` (connection string, `Auth__AdminPassword`).

Tests (integration tests start PostgreSQL with Testcontainers, so Docker must be running):

```bash
dotnet test
```

## Repository layout

```
src/
  LogHub.Api/          ASP.NET Core host, one folder per feature under Features/
  LogHub.Db/           DbUp migrator
    Scripts/Tables/    one CREATE TABLE script per table
    Scripts/Seed/      built-in roles and signals
    Scripts/Migrations/  schema changes after the first release
web/                   Angular app (src/app/core, feature, shared)
tests/
  LogHub.Api.Tests/          unit tests (CLEF parser, levels, message templates)
  LogHub.IntegrationTests/   real Serilog.Sinks.Seq against LogHub + PostgreSQL
docs/                  api (reference), deploy (self-hosted, Azure)
Dockerfile             multi-stage build (Angular + .NET)
docker-compose.yml     LogHub + PostgreSQL, built from source (evaluation, local development)
docker-compose.prod.yml  published image + PostgreSQL + Caddy HTTPS (production server)
Caddyfile              reverse proxy used by docker-compose.prod.yml
```

## Database conventions

- Short English table names (`users`, `api_key`, `event`...), snake_case columns, no quotes in SQL: `event.timestamp`. Dapper maps `api_key_id` to `ApiKeyId` (`MatchNamesWithUnderscores`).
- `bigint` identity primary keys.
- Audit columns on configuration tables: `user_created_id`, `user_created_date`, `user_updated_id`, `user_updated_date`.
- Events are partitioned by day.

## Configuration

All settings can be set with environment variables (`Section__Key`). Main ones:

| Variable | Default | Purpose |
|---|---|---|
| `ConnectionStrings__LogHub` | — | PostgreSQL connection string |
| `Auth__AdminPassword` | — | first administrator password, required on the first start (Development only: generated) |
| `Auth__Oidc__Authority`, `__ClientId`, `__ClientSecret` | — | Microsoft Entra ID / OpenID Connect sign-in |
| `Auth__Oidc__AllowedTenants__0` | — | allowed Entra tenant ids (required with a multi-tenant authority) |
| `Auth__SessionHours` / `Auth__MaxSessionHours` | 8 / 168 | idle timeout / absolute session lifetime |
| `Proxy__TrustForwardedHeaders` | false | true behind a reverse proxy / Azure ingress |
| `DataProtection__KeyVaultKeyUri` | — | encrypt the key ring with Azure Key Vault |
| `DataProtection__CertificatePath`, `__CertificatePassword` | — | encrypt the key ring with a PFX certificate (outside Azure) |
| `Ingestion__RequireApiKey` | true | reject events sent without a key |
| `Ingestion__MaxQueuedEvents` / `__MaxConcurrentRequests` | 200000 / 32 | memory and concurrency limits for ingestion |
| `Smtp__Host`, `__Port`, `__Security`, `__Username`, `__Password`, `__FromAddress`, `__PublicUrl` | — | SMTP for alerts (overrides the UI settings) |
| `Retention__DefaultDays` | — | delete events older than N days (all-events policy, read-only in the UI) |
| `Retention__IntervalMinutes` | 60 | retention job interval |
| `Alerts__AllowedRecipientDomains__0` | — | allowed domains for alert emails |

## Trademarks

"Seq" is a trademark of Datalust Pty Ltd. LogHub is not affiliated with or endorsed by Datalust.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) builds and tests the backend (unit + integration tests with Testcontainers) and the frontend on every push and pull request. Pushes to `main` and version tags (`v1.2.3`) publish the Docker image to GitHub Container Registry:

```bash
docker pull ghcr.io/maurodam/log-hub:latest
```

## License

[MIT](LICENSE)

## Author

[maurodam](https://github.com/maurodam)

### MCP access for AI assistants

- Read-only MCP tools expose event search, event details, statistics and shared signals.
- The stateless `/mcp` endpoint requires an API key with `Read`; session cookies do not grant access.

```bash
claude mcp add --transport http loghub https://<host>/mcp --header "X-Api-Key: <key with Read>"
```

See [MCP API documentation](docs/api/v1.md#mcp-read) for filters, limits and truncation.
Custom connectors on claude.ai require OAuth, which is not currently supported.
