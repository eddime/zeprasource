import Stripe from "stripe";
import { getStripeSecretKey, isStripeConfigured } from "./config";
import {
	STRIPE_MIGRATION_LOOKUP_KEYS,
	type PaidMigrationTierId,
} from "./shared/stripe-checkout";

export function createStripeClient(): Stripe {
	const secretKey = getStripeSecretKey();
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}
	return new Stripe(secretKey);
}

export function lookupKeyForTier(tierId: PaidMigrationTierId): string {
	return STRIPE_MIGRATION_LOOKUP_KEYS[tierId];
}

export async function resolvePriceId(
	stripe: Stripe,
	tierId: PaidMigrationTierId,
): Promise<string> {
	const prices = await stripe.prices.list({
		lookup_keys: [lookupKeyForTier(tierId)],
		limit: 1,
		active: true,
	});
	const price = prices.data[0];
	if (!price?.id) {
		throw new Error(
			`Stripe price not found for tier "${tierId}" (lookup_key: ${lookupKeyForTier(tierId)}).`,
		);
	}
	return price.id;
}

export { isStripeConfigured };
