# Deploy LogHub on Vercel Hobby

Vercel runs the LogHub container with Angular and the ASP.NET Core API on the same HTTPS domain. A Cloudflare Worker calls LogHub every minute to run alerts, webhook delivery, and retention. Vercel Hobby is for personal, non-commercial use. PostgreSQL comes from your chosen provider and has its own quotas. [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

## 1. Deploy LogHub

1. Create a PostgreSQL 17 database reachable from Vercel over TLS. Use the provider's direct endpoint because LogHub uses session-level PostgreSQL advisory locks. Enable or allow the `pg_trgm` extension. The database role needs permission to create tables and indexes in the LogHub database.
2. Open **Deploy to Vercel** in the [README](../../README.md#deploy-on-vercel) and select a Hobby account. Deploy from the repository root using the Container preset.
3. Enter these values in the Vercel form.

   | Variable | Value |
   | --- | --- |
   | `ConnectionStrings__LogHub` | Npgsql connection string, for example `Host=<host>;Port=5432;Database=<db>;Username=<user>;Password=<password>;SSL Mode=VerifyFull`. Use the CA settings required by your provider. |
   | `Auth__AdminPassword` | A unique password of at least 12 characters for the first `admin` account. |
   | `LogHub__SchedulerSecret` | A dedicated random token, for example the output of `openssl rand -hex 32`. |
   | `PORT` | `8080`. |
   | `LogHub__SchedulerEnabled` | `true`. |
   | `Proxy__TrustForwardedHeaders` | `true` on Vercel so LogHub sees the public HTTPS URL. |
   | `Ingestion__MaxPayloadBytes` | `4000000` to keep LogHub's request limit below Vercel's. |

4. Open `https://<project>.vercel.app/health` and check for HTTP 200. Open the app and sign in as `admin`. In **Settings → API Keys**, create a key with the `Ingest` permission and send a test event using the [Serilog example](../../README.md#send-logs-from-a-net-application) with your deployment URL.

Keep production secrets in the Production environment. If you deploy previews, give them a separate database and credentials. Point the scheduler at the stable production domain.

## 2. Configure the Cloudflare Worker

1. Clone the repository created by Vercel. Open `deploy/cloudflare/wrangler.toml` and set `LOGHUB_URL` to your production URL.
2. From the clone, deploy to a Cloudflare Workers Free account using Node.js 24. Wrangler will prompt for the Worker secret. Enter the same value you set for `LogHub__SchedulerSecret` on Vercel.

   ```sh
   cd deploy/cloudflare
   npx wrangler@4 login
   npx wrangler@4 deploy
   npx wrangler@4 secret put LOGHUB_SCHEDULER_SECRET
   ```

3. Check **Workers & Pages → loghub-scheduler → Observability** after the cron trigger has propagated. Successful job calls return HTTP 204. Configure your SMTP provider on port 465 or 587 if you use email alerts, and follow the [webhook setup](azure.md#5-webhook-alerts) for destination and HTTPS URL settings. [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [SMTP on Vercel](https://vercel.com/kb/guide/serverless-functions-and-smtp)

## Operating limits

- Set Serilog batch sizes so each encoded request stays below 4 MB. Vercel Functions have a 4.5 MB payload limit. Live tail reconnects using the last event ID when Vercel closes a stream at its execution limit. [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- Alert checks and webhook delivery run on one-minute ticks. Use alert windows longer than one minute to allow for scheduling jitter. Webhook retries run on the next eligible tick. Manual retention waits for the next tick. Scheduled retention runs at `Retention__IntervalMinutes` (60 by default).
- Cron calls and live-tail connections consume Vercel Hobby quotas. Review Vercel runtime logs and Cloudflare cron invocations for failures. Cloudflare's Free plan has separate quotas. [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- Back up PostgreSQL, including the shared Data Protection key ring. LogHub stores its keys unencrypted in PostgreSQL unless key encryption is configured. Restrict database and backup access. [Backup and restore](self-hosted.md#5-backup-and-restore)
