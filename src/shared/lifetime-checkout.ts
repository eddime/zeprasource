export type LifetimeCheckoutCreateResult =
	| {
			configured: true;
			sessionId: string;
			checkoutUrl: string;
	  }
	| {
			configured: false;
			reason: "server_not_configured" | "stripe_not_configured";
	  };

export type LifetimeCheckoutWaitResult =
	| {
			paid: true;
			sessionId: string;
			lifetimeLicense: string;
	  }
	| { paid: false; error: string; cancelled?: boolean };

export type LifetimeVerifyResult = {
	valid: true;
	stripeSessionId: string;
};

export type EntitlementStatus = {
	lifetime: boolean;
	/** Stripe Lifetime price available (display + catalog). */
	lifetimeConfigured: boolean;
	serverConfigured: boolean;
	/** Checkout + license issuance (requires Zepra server). */
	lifetimeCheckoutAvailable: boolean;
};
