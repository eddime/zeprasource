import type Stripe from "stripe";
import {
	MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES,
	STRIPE_CHECKOUT_PRICING_MODEL_LIFETIME,
	STRIPE_CHECKOUT_PRICING_MODEL_PER_GB,
} from "../shared/stripe-checkout";
import { paymentReturnBase } from "../config";
import { createStripeClient, isStripeConfigured } from "../stripe-client";
import { getLifetimePricingCatalog } from "./lifetime-pricing-catalog";
import {
	issueLifetimeLicense,
	parseLifetimeLicense,
} from "./lifetime-license";
import {
	getLifetimeBySessionId,
	storeLifetimeEntitlement,
} from "./lifetime-store";
import { quantityForPriceId } from "./checkout-session-helpers";

export type LifetimeCheckoutSessionResponse = {
	sessionId: string;
	checkoutUrl: string;
};

export type LifetimeCheckoutStatusResponse =
	| {
			status: "pending";
			sessionId: string;
	  }
	| {
			status: "paid";
			sessionId: string;
			lifetimeLicense: string;
	  }
	| {
			status: "expired" | "cancelled";
			sessionId: string;
			error: string;
	  };

async function resolveLifetimePriceId(stripe: Stripe): Promise<string> {
	const catalog = await getLifetimePricingCatalog();
	if (!catalog.configured || !catalog.priceId) {
		throw new Error("Zepra Lifetime is not configured in Stripe.");
	}
	return catalog.priceId;
}

async function retrieveSessionLineItems(
	stripe: Stripe,
	sessionId: string,
): Promise<Stripe.LineItem[]> {
	const full = await stripe.checkout.sessions.retrieve(sessionId, {
		expand: ["line_items.data.price"],
	});
	return full.line_items?.data ?? [];
}

export async function verifyLifetimeStripeSession(
	session: Stripe.Checkout.Session,
	lineItems?: Stripe.LineItem[],
): Promise<void> {
	if (session.payment_status !== "paid" || !session.id) {
		throw new Error("Stripe checkout is not paid.");
	}

	const stripe = createStripeClient();
	const expectedPriceId = await resolveLifetimePriceId(stripe);
	const items =
		lineItems ?? (await retrieveSessionLineItems(stripe, session.id));
	const lifetimeQty = quantityForPriceId(items, expectedPriceId);
	if (lifetimeQty !== 1) {
		throw new Error("Lifetime checkout must include exactly one Lifetime unit.");
	}

	const model = session.metadata?.pricing_model;
	const isDedicated = model === STRIPE_CHECKOUT_PRICING_MODEL_LIFETIME;
	const isMigrationBundle = model === STRIPE_CHECKOUT_PRICING_MODEL_PER_GB;
	if (!isDedicated && !isMigrationBundle) {
		throw new Error("Checkout is not a lifetime purchase.");
	}

	if (isDedicated) {
		const metadataPriceId = session.metadata?.stripe_price_id ?? null;
		if (metadataPriceId && metadataPriceId !== expectedPriceId) {
			throw new Error("Stripe price does not match Zepra Lifetime.");
		}
	}
}

export async function issueLifetimeFromStripeSession(
	session: Stripe.Checkout.Session,
): Promise<string | null> {
	if (session.payment_status !== "paid" || !session.id) return null;

	const existing = getLifetimeBySessionId(session.id);
	if (existing) return existing.license;

	const stripe = createStripeClient();
	const lineItems = await retrieveSessionLineItems(stripe, session.id);
	const expectedPriceId = await resolveLifetimePriceId(stripe);
	if (quantityForPriceId(lineItems, expectedPriceId) < 1) {
		return null;
	}

	await verifyLifetimeStripeSession(session, lineItems);

	const license = issueLifetimeLicense(session.id);
	const payload = parseLifetimeLicense(license);
	storeLifetimeEntitlement({
		stripeSessionId: session.id,
		license,
		jti: payload.jti,
	});
	return license;
}

/** Issue Lifetime license when customer added the optional item on a migration checkout. */
export async function fulfillLifetimeAddonFromSessionId(
	sessionId: string,
): Promise<{ issued: true; lifetimeLicense: string } | { issued: false }> {
	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured on the server.");
	}

	const cached = getLifetimeBySessionId(sessionId);
	if (cached) {
		return { issued: true, lifetimeLicense: cached.license };
	}

	const stripe = createStripeClient();
	const session = await stripe.checkout.sessions.retrieve(sessionId);
	if (session.payment_status !== "paid") {
		return { issued: false };
	}

	const license = await issueLifetimeFromStripeSession(session);
	if (!license) {
		return { issued: false };
	}
	return { issued: true, lifetimeLicense: license };
}

export async function createLifetimeCheckoutSession(): Promise<LifetimeCheckoutSessionResponse> {
	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured on the server.");
	}

	const stripe = createStripeClient();
	const catalog = await getLifetimePricingCatalog();
	if (!catalog.configured || !catalog.priceId) {
		throw new Error("Zepra Lifetime is not configured in Stripe.");
	}

	const base = paymentReturnBase();
	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		payment_method_types: [...MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES],
		line_items: [{ price: catalog.priceId, quantity: 1 }],
		success_url: `${base}/lifetime/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${base}/lifetime/cancel?session_id={CHECKOUT_SESSION_ID}`,
		metadata: {
			pricing_model: STRIPE_CHECKOUT_PRICING_MODEL_LIFETIME,
			stripe_price_id: catalog.priceId,
		},
	});

	if (!session.url || !session.id) {
		throw new Error("Stripe did not return a checkout URL.");
	}

	return { sessionId: session.id, checkoutUrl: session.url };
}

export async function getLifetimeCheckoutStatus(
	sessionId: string,
): Promise<LifetimeCheckoutStatusResponse> {
	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured on the server.");
	}

	const cached = getLifetimeBySessionId(sessionId);
	if (cached) {
		return {
			status: "paid",
			sessionId,
			lifetimeLicense: cached.license,
		};
	}

	const stripe = createStripeClient();
	const session = await stripe.checkout.sessions.retrieve(sessionId);

	if (session.status === "expired") {
		return {
			status: "expired",
			sessionId,
			error: "Checkout expired — try again.",
		};
	}

	if (session.status === "open" && session.payment_status !== "paid") {
		return { status: "pending", sessionId };
	}

	if (session.payment_status === "paid") {
		const license = await issueLifetimeFromStripeSession(session);
		if (!license) {
			return { status: "pending", sessionId };
		}
		return {
			status: "paid",
			sessionId,
			lifetimeLicense: license,
		};
	}

	return {
		status: "cancelled",
		sessionId,
		error: "Payment was not completed.",
	};
}

export async function handleLifetimeCheckoutWebhook(
	session: Stripe.Checkout.Session,
): Promise<void> {
	await issueLifetimeFromStripeSession(session);
}
