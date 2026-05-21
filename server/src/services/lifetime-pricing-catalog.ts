import type { LifetimePricingCatalog } from "../shared/lifetime-pricing-catalog";
import { formatPriceLabel } from "../shared/pricing";
import {
	STRIPE_ZEPRA_LIFETIME_LOOKUP_KEY,
} from "../shared/stripe-checkout";
import { createStripeClient, isStripeConfigured } from "../stripe-client";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: LifetimePricingCatalog | null = null;
let cachedAt = 0;

export async function getLifetimePricingCatalog(): Promise<LifetimePricingCatalog> {
	const now = Date.now();
	if (cached && now - cachedAt < CACHE_TTL_MS) {
		return cached;
	}

	if (!isStripeConfigured()) {
		const catalog: LifetimePricingCatalog = {
			configured: false,
			priceId: null,
			priceLabel: "",
			priceCents: 0,
			currency: "eur",
			error: "stripe_not_configured",
		};
		cachedAt = now;
		return catalog;
	}

	try {
		const stripe = createStripeClient();
		const response = await stripe.prices.list({
			lookup_keys: [STRIPE_ZEPRA_LIFETIME_LOOKUP_KEY],
			limit: 1,
			active: true,
			expand: ["data.product"],
		});
		const price = response.data[0];
		if (!price?.unit_amount || !price.id) {
			const catalog: LifetimePricingCatalog = {
				configured: false,
				priceId: null,
				priceLabel: "",
				priceCents: 0,
				currency: "eur",
				error: "lifetime_price_not_found",
			};
			cachedAt = now;
			return catalog;
		}

		const catalog: LifetimePricingCatalog = {
			configured: true,
			priceId: price.id,
			priceLabel: formatPriceLabel(price.unit_amount, price.currency),
			priceCents: price.unit_amount,
			currency: price.currency,
		};
		cached = catalog;
		cachedAt = now;
		return catalog;
	} catch {
		return {
			configured: false,
			priceId: null,
			priceLabel: "",
			priceCents: 0,
			currency: "eur",
			error: "stripe_fetch_failed",
		};
	}
}
