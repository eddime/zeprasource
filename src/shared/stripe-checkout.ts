/** Stripe Price lookup key — one unit = 1 GB (Wellemachen / Zepra catalog). */
export const STRIPE_MIGRATION_PER_GB_LOOKUP_KEY = "zepra_migration_per_gb";

/** One-time Zepra Lifetime — unlimited migration runs (license from Zepra Server). */
export const STRIPE_ZEPRA_LIFETIME_LOOKUP_KEY = "zepra_lifetime";

export const STRIPE_CHECKOUT_PRICING_MODEL_PER_GB = "per_gb";
export const STRIPE_CHECKOUT_PRICING_MODEL_LIFETIME = "lifetime";

export const LIFETIME_LICENSE_PREFIX = "zepra_lt";

/**
 * Migration checkout only — instant one-time payment (no SEPA direct debit).
 * Add "paypal" after enabling it in Stripe Dashboard → Payment methods.
 */
export const MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES = ["card"] as const;

export type MigrationCheckoutCreateParams = {
	/** Billed gigabytes (ceil of bytes over free limit). */
	billableGb: number;
	totalBytes: number;
	messageCount: number;
	folderCount: number;
	/** Selected source folder paths — hashed server-side for payment binding. */
	folderPaths: string[];
};

export type MigrationCheckoutCreateResult =
	| {
			configured: true;
			sessionId: string;
			checkoutUrl: string;
	  }
	| {
			configured: false;
			reason: "missing_secret_key";
	  };

export type MigrationCheckoutWaitResult =
	| {
			paid: true;
			billableGb: number;
			sessionId: string;
			/** HMAC-signed license — required to start migration (single use, not forgeable in SQLite). */
			launchTicket: string;
			/** Set when the customer added Zepra Lifetime in the same Stripe Checkout. */
			lifetimeLicense?: string;
	  }
	| { paid: false; error: string; cancelled?: boolean };
