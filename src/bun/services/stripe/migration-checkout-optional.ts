import type Stripe from "stripe";
import { isLifetimeActive } from "../lifetime/lifetime-entitlement";
import { isZepraServerConfigured } from "../zepra-server/config";
import { getLifetimePricingCatalog } from "./lifetime-pricing-catalog";

/** Lifetime add-on in Stripe Checkout (requires Zepra Server to issue the license). */
export async function buildMigrationLifetimeOptionalItems(): Promise<
	Stripe.Checkout.SessionCreateParams.OptionalItem[] | undefined
> {
	if (!isZepraServerConfigured()) return undefined;
	if (await isLifetimeActive()) return undefined;

	const catalog = await getLifetimePricingCatalog();
	if (!catalog.configured || !catalog.priceId) return undefined;

	return [
		{
			price: catalog.priceId,
			quantity: 1,
		},
	];
}
