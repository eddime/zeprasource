/** Stripe Price lookup key — one unit = 1 GB (Wellemachen / Zepra live catalog). */
export const STRIPE_MIGRATION_PER_GB_LOOKUP_KEY = "zepra_migration_per_gb";

/** One-time purchase — unlimited migration runs (signed license from Zepra Server). */
export const STRIPE_ZEPRA_LIFETIME_LOOKUP_KEY = "zepra_lifetime";

export const STRIPE_CHECKOUT_PRICING_MODEL_PER_GB = "per_gb";
export const STRIPE_CHECKOUT_PRICING_MODEL_LIFETIME = "lifetime";

/** Instant methods only — excludes SEPA. Add "paypal" when enabled in Dashboard. */
export const MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES = ["card"] as const;

export type MigrationCheckoutCreateBody = {
	billableGb: number;
	totalBytes: number;
	messageCount: number;
	folderCount: number;
	folderPaths: string[];
};
