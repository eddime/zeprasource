/**
 * Sets live Stripe price for Stampede (lookup_key: zepra_migration_stampede) to €29.
 * Deactivates the previous active price with that lookup key.
 *
 * Usage: bun run scripts/update-stampede-stripe-price.ts
 * Requires STRIPE_SECRET_KEY in mailport/.env
 */
import Stripe from "stripe";

const LOOKUP_KEY = "zepra_migration_stampede";
const UNIT_AMOUNT_CENTS = 2900;

async function main(): Promise<void> {
	const envText = await Bun.file(`${import.meta.dir}/../.env`).text().catch(() => "");
	for (const line of envText.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
		if (!process.env[key]) process.env[key] = value;
	}

	const secret = process.env.STRIPE_SECRET_KEY?.trim();
	if (!secret) {
		console.error("STRIPE_SECRET_KEY missing in mailport/.env");
		process.exit(1);
	}

	const stripe = new Stripe(secret);
	const existing = await stripe.prices.list({
		lookup_keys: [LOOKUP_KEY],
		limit: 10,
		active: true,
	});

	const current = existing.data[0];
	if (!current) {
		console.error(`No active Stripe price for lookup_key ${LOOKUP_KEY}.`);
		process.exit(1);
	}

	if (current.unit_amount === UNIT_AMOUNT_CENTS && current.currency === "eur") {
		console.log(`Stampede already €29 (${current.id}).`);
		return;
	}

	const productId =
		typeof current.product === "string" ? current.product : current.product.id;

	await stripe.prices.update(current.id, {
		lookup_key: `${LOOKUP_KEY}_archived_${Date.now()}`,
		active: false,
	});

	const created = await stripe.prices.create({
		product: productId,
		unit_amount: UNIT_AMOUNT_CENTS,
		currency: "eur",
		lookup_key: LOOKUP_KEY,
	});

	console.log(`Deactivated ${current.id} (was ${(current.unit_amount ?? 0) / 100} ${current.currency}).`);
	console.log(`Created ${created.id} — €29 with lookup_key ${LOOKUP_KEY}.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
