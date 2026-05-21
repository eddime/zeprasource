export type MigrationPricingCatalog = {
	configured: boolean;
	/** Active Stripe Price id — used for Checkout line items. */
	priceId: string | null;
	freeLimitGb: number;
	freeLimitBytes: number;
	pricePerGbCents: number;
	pricePerGbLabel: string;
	currency: string;
	/** Set when configured is false (e.g. stripe_not_configured). */
	error?: string;
};
