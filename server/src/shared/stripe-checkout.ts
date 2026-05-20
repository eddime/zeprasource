/** Stripe Price lookup keys (Wellemachen / Zepra live catalog). */
export const STRIPE_MIGRATION_LOOKUP_KEYS = {
	starter: "zepra_migration_trot",
	plus: "zepra_migration_gallop",
	pro: "zepra_migration_stampede",
} as const;

export type PaidMigrationTierId = keyof typeof STRIPE_MIGRATION_LOOKUP_KEYS;

/** Instant methods only — excludes SEPA. Add "paypal" when enabled in Dashboard. */
export const MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES = ["card"] as const;

export type MigrationCheckoutCreateBody = {
	tierId: PaidMigrationTierId;
	totalBytes: number;
	messageCount: number;
	folderCount: number;
	folderPaths: string[];
};
