import Stripe from "stripe";
import type { MigrationPricingCatalog } from "../../../shared/migration-pricing-catalog";
import {
	migrationCatalogFromStripePrice,
	migrationCatalogUnavailable,
} from "../../../shared/stripe-migration-catalog";
import { STRIPE_MIGRATION_PER_GB_LOOKUP_KEY } from "../../../shared/stripe-checkout";
import { getStripeSecretKey, isStripeConfigured } from "./stripe-config";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: MigrationPricingCatalog | null = null;
let cachedAt = 0;

function createStripeClient(): Stripe {
	const secretKey = getStripeSecretKey();
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}
	return new Stripe(secretKey);
}

async function fetchStripeMigrationCatalog(): Promise<MigrationPricingCatalog> {
	if (!isStripeConfigured()) {
		return migrationCatalogUnavailable("stripe_not_configured");
	}

	const stripe = createStripeClient();
	try {
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
			if (legacy.data.length > 0) {
				return migrationCatalogUnavailable("legacy_tier_prices_only");
			}
			return migrationCatalogUnavailable("price_not_found");
		}

		const product =
			typeof price.product === "object" && price.product && "metadata" in price.product
				? price.product
				: null;

		return migrationCatalogFromStripePrice({
			id: price.id,
			unit_amount: price.unit_amount,
			currency: price.currency,
			metadata: price.metadata as Record<string, string>,
			productMetadata: product?.metadata as Record<string, string> | undefined,
		});
	} catch {
		return migrationCatalogUnavailable("stripe_fetch_failed");
	}
}

export async function getMigrationPricingCatalog(): Promise<MigrationPricingCatalog> {
	const now = Date.now();
	if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
		return cachedCatalog;
	}

	const catalog = await fetchStripeMigrationCatalog();
	// Only cache successful catalogs — retry immediately after Dashboard fixes.
	if (catalog.configured) {
		cachedCatalog = catalog;
		cachedAt = now;
	}
	return catalog;
}

/** Clears cache after dashboard price changes (tests). */
export function clearMigrationPricingCatalogCache(): void {
	cachedCatalog = null;
	cachedAt = 0;
}
