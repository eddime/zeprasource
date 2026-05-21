import type Stripe from "stripe";
import { getLifetimePricingCatalog } from "./lifetime-pricing-catalog";

/** Lifetime upsell on migration checkout (optional_items in Stripe Hosted Checkout). */
export async function buildMigrationLifetimeOptionalItems(): Promise<
	Stripe.Checkout.SessionCreateParams.OptionalItem[] | undefined
> {
	const catalog = await getLifetimePricingCatalog();
	if (!catalog.configured || !catalog.priceId) return undefined;

	return [
		{
			price: catalog.priceId,
			quantity: 1,
		},
	];
}
