# Self-host LogHub on a server

Recommended setup: one Linux server with Docker, three containers started by [`docker-compose.prod.yml`](../../docker-compose.prod.yml).

| Container | Image | Role |
|---|---|---|
| `proxy` | `caddy:2-alpine` | HTTPS on ports 80/443, automatic Let's Encrypt certificate, forwards to LogHub |
| `app` | `ghcr.io/maurodam/log-hub` | LogHub (API + UI), port 8080 on the internal network only |
| `db` | `postgres:17-alpine` | PostgreSQL, internal network only, data in the `db-data` volume |

No repository clone and no build on the server: you need three files, `docker-compose.prod.yml`, `Caddyfile` and `.env`.

## 1. Requirements

- Docker Engine with the Compose plugin (`docker compose version`).
- A DNS name (for example `loghub.example.com`) pointing to the server.
- Ports 80 and 443 open from the internet (Caddy needs port 80 for the certificate challenge).
- Disk space for PostgreSQL: it grows with event volume and `Retention__DefaultDays`.

## 2. Install

```bash
mkdir -p /opt/loghub && cd /opt/loghub
curl -fsSLO https://raw.githubusercontent.com/maurodam/log-hub/main/docker-compose.prod.yml
curl -fsSLO https://raw.githubusercontent.com/maurodam/log-hub/main/Caddyfile
curl -fsSL  https://raw.githubusercontent.com/maurodam/log-hub/main/.env.example -o .env
chmod 600 .env
```

Edit `.env`:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | a long random password (`openssl rand -base64 32`) |
| `LOGHUB_DOMAIN` | your DNS name, e.g. `loghub.example.com` |
| `LOGHUB_VERSION` | `latest`, or a fixed version such as `1.2` / `1.2.3` (recommended) |
| `Auth__AdminPassword` | first administrator password, at least 12 characters |
| `Retention__DefaultDays` | e.g. `180`, or empty to manage retention in the UI |

`ConnectionStrings__LogHub`, `POSTGRES_PORT`, `LOGHUB_PORT` and `Proxy__TrustForwardedHeaders` are ignored by this compose file: it builds the connection string from the `POSTGRES_*` values and always trusts the Caddy proxy.

Start:

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f app
```

LogHub creates its tables on the first start. Open `https://<LOGHUB_DOMAIN>`, sign in as `admin` with `Auth__AdminPassword`, then change the password. The admin password in `.env` is used only while the database has no accounts: you can remove it after the first start.

Check: `curl https://<LOGHUB_DOMAIN>/health` returns 200 when LogHub reaches the database.

If the image is private in GitHub Container Registry, run `docker login ghcr.io` first with a token that has `read:packages`.

## 3. Send logs

1. *Settings → API Keys*: create one key per application, with the `Ingest` permission and an applied property such as `App=Billing`.
2. In the application:

```csharp
Log.Logger = new LoggerConfiguration()
    .WriteTo.Seq("https://loghub.example.com", apiKey: "<API key>")
    .CreateLogger();
```

## 4. Optional settings

Every variable in [`.env.example`](../../.env.example) and in the README [configuration table](../../README.md#configuration) reaches the container through `env_file`. After changing `.env`:

```bash
docker compose -f docker-compose.prod.yml up -d
```

**Email alerts**: `Smtp__Host`, `Smtp__Port`, `Smtp__Security`, `Smtp__Username`, `Smtp__Password`, `Smtp__FromAddress`, `Smtp__PublicUrl=https://<LOGHUB_DOMAIN>`, or configure them in *Settings → Email*.

**Microsoft Entra ID sign-in**: same variables as in the [Azure guide](azure.md#3-microsoft-entra-id-sign-in-optional). Redirect URI: `https://<LOGHUB_DOMAIN>/signin-oidc`.

**Encrypt the key ring**: LogHub keeps the keys that protect sessions and stored secrets in PostgreSQL. Without a certificate they are stored unencrypted (LogHub writes a warning at startup). To encrypt them:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes -subj "/CN=LogHub Data Protection" \
  -keyout certs/dp.key -out certs/dp.crt
openssl pkcs12 -export -inkey certs/dp.key -in certs/dp.crt -out certs/dataprotection.pfx -passout pass:<password>
rm certs/dp.key
```

Then set `DataProtection__CertificatePath=/certs/dataprotection.pfx` and `DataProtection__CertificatePassword=<password>` in `.env`, and uncomment the `volumes` lines of the `app` service. Keep a copy of the PFX with your backups: without it, existing sessions and encrypted settings (such as the SMTP password) cannot be read.

## 5. Backup and restore

Database backup (compressed custom format):

```bash
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > loghub-$(date +%F).dump
```

Schedule it with cron, for example every night at 02:00, and copy the files off the server:

```
0 2 * * * cd /opt/loghub && docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backups/loghub-$(date +\%F).dump
```

Also back up `.env` and `certs/` (if used).

Restore (replaces the current data):

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < loghub-2026-10-20.dump
docker compose -f docker-compose.prod.yml start app
```

## 6. Upgrade

1. Take a backup (section 5).
2. Set the new `LOGHUB_VERSION` in `.env` (or keep `latest`).
3. Pull and restart:

```bash
docker compose -f docker-compose.prod.yml pull app
docker compose -f docker-compose.prod.yml up -d
```

Database migrations run automatically at startup. To go back to the previous version, restore the backup taken in step 1 and set the old `LOGHUB_VERSION`.

## 7. Use an existing reverse proxy

If the server already runs nginx, Traefik or another proxy, remove the `proxy` service from `docker-compose.prod.yml`, publish LogHub on localhost only and point your proxy to it:

```yaml
  app:
    ports:
      - "127.0.0.1:8080:8080"
```

Never publish port 8080 on a public interface: with `Proxy__TrustForwardedHeaders=true` LogHub trusts the `X-Forwarded-*` headers from any client.

nginx example:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name loghub.example.com;

    ssl_certificate     /etc/letsencrypt/live/loghub.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/loghub.example.com/privkey.pem;

    # Ingestion accepts payloads up to 10 MB (Ingestion__MaxPayloadBytes); the nginx default is 1 MB.
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
    }

    # Live tail (Server-Sent Events): no buffering, long-lived connection.
    location /api/v1/events/stream {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header Connection        "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}

server {
    listen 80;
    server_name loghub.example.com;
    return 301 https://$host$request_uri;
}
```

## 8. Build from source instead of the published image

On a machine with the repository checked out:

```bash
cp .env.example .env    # set the values as in section 2
docker compose up --build -d
```

This uses [`docker-compose.yml`](../../docker-compose.yml): plain HTTP on `LOGHUB_PORT` (default 8080) and PostgreSQL published on `POSTGRES_PORT`. Use it for evaluation on a private network, or put your own HTTPS proxy in front (section 7).
