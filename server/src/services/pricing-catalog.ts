import {
	buildPricingPlans,
	FALLBACK_MIGRATION_PRICE_LABELS,
	type MigrationPricingCatalog,
} from "../shared/migration-pricing-catalog";
import {
	STRIPE_MIGRATION_LOOKUP_KEYS,
	type PaidMigrationTierId,
} from "../shared/stripe-checkout";
import {
	createStripeClient,
	isStripeConfigured,
} from "../stripe-client";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: MigrationPricingCatalog | null = null;
let cachedAt = 0;

function formatStripeUnitAmount(unitAmount: number, currency: string): string {
	const value = unitAmount / 100;
	const code = currency.toUpperCase();
	const wholeEuro = code === "EUR" && unitAmount % 100 === 0;
	return new Intl.NumberFormat("de-DE", {
		style: "currency",
		currency: code,
		minimumFractionDigits: wholeEuro ? 0 : 2,
		maximumFractionDigits: wholeEuro ? 0 : 2,
	}).format(value);
}

function lookupKeyToTierId(lookupKey: string): PaidMigrationTierId | null {
	for (const [tierId, key] of Object.entries(STRIPE_MIGRATION_LOOKUP_KEYS)) {
		if (key === lookupKey) return tierId as PaidMigrationTierId;
	}
	return null;
}

export async function getMigrationPricingCatalog(): Promise<MigrationPricingCatalog> {
	const now = Date.now();
	if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
		return cachedCatalog;
	}

	const labels = { ...FALLBACK_MIGRATION_PRICE_LABELS };
	let configured = false;

	if (isStripeConfigured()) {
		try {
			const stripe = createStripeClient();
			const lookupKeys = Object.values(STRIPE_MIGRATION_LOOKUP_KEYS);
			const response = await stripe.prices.list({
				lookup_keys: lookupKeys,
				limit: lookupKeys.length,
				active: true,
			});

			let fetchedPaidTiers = 0;
			for (const price of response.data) {
				if (!price.lookup_key || price.unit_amount == null) continue;
				const tierId =
					(price.metadata?.tier_id as PaidMigrationTierId | undefined) ??
					lookupKeyToTierId(price.lookup_key);
				if (tierId !== "starter" && tierId !== "plus" && tierId !== "pro") {
					continue;
				}
				labels[tierId] = formatStripeUnitAmount(
					price.unit_amount,
					price.currency,
				);
				fetchedPaidTiers += 1;
			}
			configured = fetchedPaidTiers === lookupKeys.length;
		} catch {
			/* fall back to static labels */
		}
	}

	const catalog: MigrationPricingCatalog = {
		configured,
		priceLabels: labels,
		plans: buildPricingPlans(labels),
	};

	cachedCatalog = catalog;
	cachedAt = now;
	return catalog;
}
