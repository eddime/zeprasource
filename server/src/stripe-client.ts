import Stripe from "stripe";
import { STRIPE_MIGRATION_PER_GB_LOOKUP_KEY } from "./shared/stripe-checkout";

export function getStripeSecretKey(): string | undefined {
	const key = process.env.STRIPE_SECRET_KEY?.trim();
	return key && key.length > 0 ? key : undefined;
}

export function isStripeConfigured(): boolean {
	return Boolean(getStripeSecretKey());
}

export function createStripeClient(): Stripe {
	const secretKey = getStripeSecretKey();
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}
	return new Stripe(secretKey);
}

export async function resolvePerGbPriceId(stripe: Stripe): Promise<string> {
	const prices = await stripe.prices.list({
		lookup_keys: [STRIPE_MIGRATION_PER_GB_LOOKUP_KEY],
		limit: 1,
		active: true,
	});
	const price = prices.data[0];
	if (!price?.id) {
		throw new Error(
			`Stripe price not found (lookup_key: ${STRIPE_MIGRATION_PER_GB_LOOKUP_KEY}).`,
		);
	}
	return price.id;
}
