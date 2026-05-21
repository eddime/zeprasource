import { STRIPE_MIGRATION_PER_GB_LOOKUP_KEY } from "../../../shared/stripe-checkout";

export const ZEPRA_PAYMENT_URL_SCHEME = "zepra";

export function paymentReturnBase(): string {
	return `${ZEPRA_PAYMENT_URL_SCHEME}://payment`;
}

export function getStripeSecretKey(): string | undefined {
	const key = process.env.STRIPE_SECRET_KEY?.trim();
	return key && key.length > 0 ? key : undefined;
}

export function isStripeConfigured(): boolean {
	return Boolean(getStripeSecretKey());
}

export function migrationPerGbLookupKey(): string {
	return STRIPE_MIGRATION_PER_GB_LOOKUP_KEY;
}
