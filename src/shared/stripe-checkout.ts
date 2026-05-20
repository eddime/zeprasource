/** Stripe Price lookup keys (Wellemachen / Zepra live catalog). */
export const STRIPE_MIGRATION_LOOKUP_KEYS = {
	starter: "zepra_migration_trot",
	plus: "zepra_migration_gallop",
	pro: "zepra_migration_stampede",
} as const;

export type PaidMigrationTierId = keyof typeof STRIPE_MIGRATION_LOOKUP_KEYS;

export type MigrationCheckoutCreateParams = {
	tierId: PaidMigrationTierId;
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
			tierId: PaidMigrationTierId;
			sessionId: string;
			/** HMAC-signed license — required to start migration (single use, not forgeable in SQLite). */
			launchTicket: string;
	  }
	| { paid: false; error: string; cancelled?: boolean };
