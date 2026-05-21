# Stripe setup (migration pricing)

Paid migrations use **Stripe Checkout** with linear **per-gigabyte** pricing. The app does not hardcode prices or free limits — it reads them from your Stripe catalog at runtime.

## Single source of truth

| What | Stripe source |
|------|----------------|
| Price per GB, currency | Active **Price** with `lookup_key` `zepra_migration_per_gb` |
| Free tier (e.g. 2 GB) | Metadata `free_migration_gb` on that **Price** or its **Product** |
| Checkout line item | Same Price ID × `quantity` = billed GB (rounded up) |

If Stripe is missing, misconfigured, or unreachable, the UI shows an error — not a fallback price.

## Dashboard: create the catalog

### 1. Product (optional metadata)

Stripe → **Product catalog** → create e.g. **Zepra — pay per migration**.

**Description** (shown in Checkout — avoid “license up to X GB”; that sounds like buying the app once):

> One-time payment for this migration run only. Billed per gigabyte over the free tier — not a subscription and not a lifetime license for the app.

Optional metadata on the product:

| Key | Value | Example |
|-----|-------|---------|
| `free_migration_gb` | Free gigabytes per migration | `2` |

### 2. Price (required)

Add a **one-time** price on that product:

| Field | Value |
|-------|--------|
| Amount | e.g. **$0.75** USD per unit |
| Billing | One time |
| **Lookup key** | `zepra_migration_per_gb` |
| Active | Yes |

**Metadata** on the price (required if not on the product):

| Key | Value |
|-----|-------|
| `free_migration_gb` | `2` |

One unit = **1 billed gigabyte**. Example: 10 GB mailbox with 2 GB free → 8 GB overage → Checkout `quantity: 8` → $6.00 at $0.75/GB.

### 3. Payment methods

Checkout uses **card** only by default. Enable **PayPal** in Dashboard → **Settings → Payment methods** if you want it later (code change required to add `"paypal"` to allowed types).

## Zepra Lifetime (249 €, unlimited runs)

- **Stripe:** one-time Price, lookup key `zepra_lifetime` (249 € recommended).
- **License:** Server signs `zepra_lt.<payload>.<hmac>` with `ZEPRA_LICENSE_SIGNING_SECRET` — the desktop app cannot forge this.
- **Registry:** Server stores issued licenses in `server/data/lifetime-entitlements.json`.
- **Desktop:** requires `ZEPRA_SERVER_URL` in `mailport/.env`; purchases and verification go through the server API.
- **Migration upsell:** When the server and Lifetime price are configured, migration Checkout Sessions include a Stripe **`optional_items`** entry for Lifetime. Customers can add it in Hosted Checkout (same payment as the per-GB line). The server issues the Lifetime license from the same `cs_…` session (`POST /v1/checkout/sessions/:id/lifetime-fulfillment` or webhook).

See [server/README.md](../server/README.md) for endpoints.

## Local env (desktop app)

```bash
cd mailport
cp .env.example .env
```

```env
STRIPE_SECRET_KEY=sk_test_…
ZEPRA_SERVER_URL=http://127.0.0.1:8787
ZEPRA_LICENSE_SIGNING_SECRET=…   # nur auf dem Server (server/.env)
```

Restart the app after changes (`bun run dev` or a fresh build). Start the license server with `cd server && bun run dev`.

The Bun main process loads the catalog via RPC (`getMigrationPricingCatalog`), caches it for **5 minutes**, and uses it for:

- Pricing sheet and folder/dock quotes
- Size estimates (`requiresPayment`, `freeLimitBytes`)
- Checkout session creation and payment verification

## How billing is calculated

1. Measure selected folders (total bytes).
2. Subtract `free_migration_gb` (from Stripe metadata).
3. **Ceil** remaining bytes to whole GB → `billableGb`.
4. Charge: `billableGb × unit_amount` via Stripe Checkout.

Checkout session metadata (for verification) includes:

- `billable_gb`, `total_bytes`, `message_count`, `folder_paths_hash`
- `free_migration_gb`, `stripe_price_id`, `pricing_model: per_gb`

## Hosted server (optional)

For production, secrets can live on **Zepra Server** instead of the desktop build. See [server/README.md](../server/README.md).

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/pricing/catalog` | Same catalog shape as the desktop RPC |
| `POST /v1/checkout/sessions` | Create Checkout (`billableGb`, `totalBytes`, …) |

Server uses the same lookup key and metadata rules.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| “Stripe is not configured” | Set `STRIPE_SECRET_KEY` in `mailport/.env`, restart |
| “Price not found” | Active price with lookup key `zepra_migration_per_gb` |
| “missing free_migration_gb metadata” | Add `free_migration_gb` to Price or Product metadata |
| UI stuck on “Loading rate from Stripe…” | Check network, API key, Stripe mode (test vs live) |
| Billable GB mismatch at checkout | Client and Stripe must use the same `free_migration_gb`; reload catalog after Dashboard edits (or wait 5 min cache) |

After changing price or metadata in Dashboard, restart the app or wait for the catalog cache to expire.

## Test mode

1. Use **Test mode** keys (`sk_test_…`) in `.env`.
2. Create the price + metadata in the **test** catalog (mirror production).
3. Pay with [Stripe test cards](https://docs.stripe.com/testing#cards) in Checkout.

## Security notes

- Never commit `STRIPE_SECRET_KEY`; `.env` is gitignored.
- Launch tickets after payment are HMAC-signed server-side; clients cannot forge paid entitlements in SQLite.
- Folder selection is hashed into checkout metadata so payment binds to the current selection.
