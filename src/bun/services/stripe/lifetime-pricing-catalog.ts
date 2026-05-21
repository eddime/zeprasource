import Stripe from "stripe";
import type { LifetimePricingCatalog } from "../../../shared/lifetime-pricing-catalog";
import {
	lifetimeCatalogFromStripePrice,
	lifetimeCatalogUnavailable,
} from "../../../shared/stripe-lifetime-catalog";
import { STRIPE_ZEPRA_LIFETIME_LOOKUP_KEY } from "../../../shared/stripe-checkout";
import { getStripeSecretKey, isStripeConfigured } from "./stripe-config";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCatalog: LifetimePricingCatalog | null = null;
let cachedAt = 0;

function createStripeClient(): Stripe {
	const secretKey = getStripeSecretKey();
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}
	return new Stripe(secretKey);
}

async function fetchStripeLifetimeCatalog(): Promise<LifetimePricingCatalog> {
	if (!isStripeConfigured()) {
		return lifetimeCatalogUnavailable("stripe_not_configured");
	}

	const stripe = createStripeClient();
	try {
		const response = await stripe.prices.list({
			lookup_keys: [STRIPE_ZEPRA_LIFETIME_LOOKUP_KEY],
			limit: 1,
			active: true,
			expand: ["data.product"],
		});
		const price = response.data[0];
		if (!price?.unit_amount || !price.id) {
			return lifetimeCatalogUnavailable("lifetime_price_not_found");
		}

		return lifetimeCatalogFromStripePrice({
			id: price.id,
			unit_amount: price.unit_amount,
			currency: price.currency,
		});
	} catch {
		return lifetimeCatalogUnavailable("stripe_fetch_failed");
	}
}

export async function getLifetimePricingCatalog(): Promise<LifetimePricingCatalog> {
	const now = Date.now();
	if (cachedCatalog && now - cachedAt < CACHE_TTL_MS) {
		return cachedCatalog;
	}

	const catalog = await fetchStripeLifetimeCatalog();
	if (catalog.configured) {
		cachedCatalog = catalog;
		cachedAt = now;
	}
	return catalog;
}

export function clearLifetimePricingCatalogCache(): void {
	cachedCatalog = null;
	cachedAt = 0;
}
