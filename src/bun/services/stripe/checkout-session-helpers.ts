import type Stripe from "stripe";

export function priceIdFromLineItem(
	item: Stripe.LineItem,
): string | null {
	const price = item.price;
	if (!price) return null;
	return typeof price === "string" ? price : price.id;
}

export function quantityForPriceId(
	lineItems: Stripe.LineItem[],
	priceId: string,
): number {
	let total = 0;
	for (const item of lineItems) {
		if (priceIdFromLineItem(item) === priceId) {
			total += item.quantity ?? 0;
		}
	}
	return total;
}

export function sessionHasLifetimeLineItem(
	lineItems: Stripe.LineItem[],
	lifetimePriceId: string,
): boolean {
	return quantityForPriceId(lineItems, lifetimePriceId) >= 1;
}
