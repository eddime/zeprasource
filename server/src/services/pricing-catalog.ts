import type { MigrationPricingCatalog } from "../shared/migration-pricing-catalog";
import {
	migrationCatalogFromStripePrice,
	migrationCatalogUnavailable,
} from "../shared/stripe-migration-catalog";
import { STRIPE_MIGRATION_PER_GB_LOOKUP_KEY } from "../shared/stripe-checkout";
import { createStripeClient, isStripeConfigured } from "../stripe-client";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: MigrationPricingCatalog | null = null;
let cachedAt = 0;

export async function getMigrationPricingCatalog(): Promise<MigrationPricingCatalog> {
	const now = Date.now();
	if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
		return cachedCatalog;
	}

	if (!isStripeConfigured()) {
		const catalog = migrationCatalogUnavailable("stripe_not_configured");
		cachedCatalog = catalog;
		cachedAt = now;
		return catalog;
	}

	try {
		const stripe = createStripeClient();
		const response = await stripe.prices.list({
			lookup_keys: [STRIPE_MIGRATION_PER_GB_LOOKUP_KEY],
			limit: 1,
			active: true,
			expand: ["data.product"],
		});
		const price = response.data[0];
		if (!price?.unit_amount || !price.id) {
			const legacy = await stripe.prices.list({
				lookup_keys: [
					"zepra_migration_trot",
					"zepra_migration_gallop",
					"zepra_migration_stampede",
				],
				limit: 3,
				active: true,
			});
			const catalog = migrationCatalogUnavailable(
				legacy.data.length > 0 ? "legacy_tier_prices_only" : "price_not_found",
			);
			cachedAt = now;
			return catalog;
		}

		const product =
			typeof price.product === "object" && price.product && "metadata" in price.product
				? price.product
				: null;

		const catalog = migrationCatalogFromStripePrice({
			id: price.id,
			unit_amount: price.unit_amount,
			currency: price.currency,
			metadata: price.metadata as Record<string, string>,
			productMetadata: product?.metadata as Record<string, string> | undefined,
		});
		if (catalog.configured) {
			cachedCatalog = catalog;
		}
		cachedAt = now;
		return catalog;
	} catch {
		return migrationCatalogUnavailable("stripe_fetch_failed");
	}
}
