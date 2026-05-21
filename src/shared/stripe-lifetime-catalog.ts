import type { LifetimePricingCatalog } from "./lifetime-pricing-catalog";
import { formatPriceLabel } from "./pricing";

export type StripeLifetimePriceSnapshot = {
	id: string;
	unit_amount: number;
	currency: string;
};

export function lifetimeCatalogFromStripePrice(
	price: StripeLifetimePriceSnapshot,
): LifetimePricingCatalog {
	return {
		configured: true,
		priceId: price.id,
		priceLabel: formatPriceLabel(price.unit_amount, price.currency),
		priceCents: price.unit_amount,
		currency: price.currency,
	};
}

export function lifetimeCatalogUnavailable(
	error: string,
	currency = "eur",
): LifetimePricingCatalog {
	return {
		configured: false,
		priceId: null,
		priceLabel: "",
		priceCents: 0,
		currency,
		error,
	};
}
