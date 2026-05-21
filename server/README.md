# Zepra Server

HTTP API for Stripe Checkout, webhooks, and signed migration licenses. The desktop app (`mailport/`) calls this service so **`STRIPE_SECRET_KEY` and `ZEPRA_LICENSE_SIGNING_SECRET` never ship in the client**.

## Deploy

Point your host’s **root directory** to this folder (`server/`).

| Platform | Start command | Notes |
|----------|---------------|--------|
| Railway / Fly / Render | `bun run start` | Set `PORT` automatically |
| Docker | `bun install && bun run start` | Bun 1.x base image |

Required env vars: see [`.env.example`](./.env.example).

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Liveness + Stripe configured flag |
| `GET` | `/v1/pricing/catalog` | — | `{ perGb, lifetime }` from Stripe |
| `POST` | `/v1/checkout/lifetime-sessions` | optional | Create Lifetime Checkout (249 €) |
| `GET` | `/v1/checkout/lifetime-sessions/:id` | optional | Poll → `lifetimeLicense` (`zepra_lt.…`) |
| `POST` | `/v1/lifetime/verify` | optional | Verify signed lifetime license + Stripe session |
| `POST` | `/v1/checkout/sessions` | optional `X-Zepra-Api-Key` | Create Checkout Session |
| `GET` | `/v1/checkout/sessions/:sessionId` | optional | Poll until `paid` + `launchTicket` |
| `POST` | `/v1/licenses/verify` | optional | Verify ticket + folder binding |
| `POST` | `/v1/webhooks/stripe` | Stripe signature | `checkout.session.completed` → issue ticket |

### Create checkout

```http
POST /v1/checkout/sessions
Content-Type: application/json

{
  "billableGb": 8,
  "totalBytes": 15000000000,
  "messageCount": 1200,
  "folderCount": 3,
  "folderPaths": ["INBOX", "Sent"]
}
```

`billableGb` must match `totalBytes` and the free limit from Stripe (`free_migration_gb` metadata). See [docs/STRIPE.md](../docs/STRIPE.md).

Response `201`:

```json
{
  "sessionId": "cs_…",
  "checkoutUrl": "https://checkout.stripe.com/…"
}
```

### Poll after payment

```http
GET /v1/checkout/sessions/cs_…
```

When paid:

```json
{
  "status": "paid",
  "sessionId": "cs_…",
  "billableGb": 8,
  "launchTicket": "zepra1.…"
}
```

## Stripe webhook

1. Dashboard → **Developers → Webhooks** → Add endpoint  
2. URL: `https://<your-host>/v1/webhooks/stripe`  
3. Event: `checkout.session.completed`  
4. Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET`

Polling `/v1/checkout/sessions/:id` still works if the webhook is delayed.

## Local dev

```bash
cd server
cp .env.example .env
# fill STRIPE_SECRET_KEY, ZEPRA_LICENSE_SIGNING_SECRET, STRIPE_WEBHOOK_SECRET (stripe listen)
bun install
bun run dev
```

Forward webhooks:

```bash
stripe listen --forward-to localhost:8787/v1/webhooks/stripe
```

## Desktop integration (next step)

In `mailport/.env` (not committed):

```env
ZEPRA_SERVER_URL=https://your-deployed-host
ZEPRA_API_KEY=…   # if you set ZEPRA_API_KEY on the server
```

The app will:

1. `POST /v1/checkout/sessions` instead of local `createMigrationCheckout`
2. `GET /v1/checkout/sessions/:id` instead of local Stripe polling
3. Use `launchTicket` signed with **`ZEPRA_LICENSE_SIGNING_SECRET`** (server only)

Remove `STRIPE_SECRET_KEY` from production desktop builds.

## License ticket format

Same as today: `zepra1.<base64url payload>.<hmac>`, but HMAC uses `ZEPRA_LICENSE_SIGNING_SECRET` on the server — **not** the Stripe secret.
