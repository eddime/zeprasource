import Stripe from "stripe";
import type {
	MigrationCheckoutCreateParams,
	MigrationCheckoutCreateResult,
	MigrationCheckoutWaitResult,
	PaidMigrationTierId,
} from "../../../shared/stripe-checkout";
import { hashFolderSelection } from "../../../shared/migration-payment";
import { getPricingTier } from "../../../shared/pricing";
import { grantMigrationLaunchTicket } from "./migration-payment-entitlements";
import {
	getStripeSecretKey,
	isStripeConfigured,
	lookupKeyForTier,
	paymentReturnBase,
	ZEPRA_PAYMENT_URL_SCHEME,
} from "./stripe-config";
import {
	getCheckoutEntry,
	markCheckoutCancelled,
	markCheckoutPaid,
	registerCheckoutSession,
	removeCheckoutSession,
} from "./checkout-registry";

const POLL_INTERVAL_MS = 1500;
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;

function createStripeClient(): Stripe {
	const secretKey = getStripeSecretKey();
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}
	return new Stripe(secretKey);
}

async function resolvePriceId(
	stripe: Stripe,
	tierId: PaidMigrationTierId,
): Promise<string> {
	const lookupKey = lookupKeyForTier(tierId);
	const prices = await stripe.prices.list({
		lookup_keys: [lookupKey],
		limit: 1,
		active: true,
	});
	const price = prices.data[0];
	if (!price?.id) {
		throw new Error(
			`Stripe price not found for tier "${tierId}" (lookup_key: ${lookupKey}).`,
		);
	}
	return price.id;
}

function assertTierMatchesEstimate(
	tierId: PaidMigrationTierId,
	totalBytes: number,
): void {
	const expected = getPricingTier(totalBytes);
	if (expected.id !== tierId) {
		throw new Error(
			`Pricing tier mismatch (expected ${expected.id}, got ${tierId}).`,
		);
	}
}

export function isMigrationCheckoutConfigured(): boolean {
	return isStripeConfigured();
}

export async function createMigrationCheckout(
	params: MigrationCheckoutCreateParams,
): Promise<MigrationCheckoutCreateResult> {
	if (!isStripeConfigured()) {
		return { configured: false, reason: "missing_secret_key" };
	}

	assertTierMatchesEstimate(params.tierId, params.totalBytes);

	const stripe = createStripeClient();
	const priceId = await resolvePriceId(stripe, params.tierId);
	const base = paymentReturnBase();

	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${base}/cancel?session_id={CHECKOUT_SESSION_ID}`,
		metadata: {
			tier_id: params.tierId,
			total_bytes: String(params.totalBytes),
			message_count: String(params.messageCount),
			folder_count: String(params.folderCount),
			folder_paths_hash: hashFolderSelection(params.folderPaths),
		},
	});

	if (!session.url || !session.id) {
		throw new Error("Stripe did not return a checkout URL.");
	}

	registerCheckoutSession(session.id, {
		tierId: params.tierId,
		totalBytes: params.totalBytes,
		messageCount: params.messageCount,
		folderPaths: params.folderPaths,
	});

	return {
		configured: true,
		sessionId: session.id,
		checkoutUrl: session.url,
	};
}

export function handlePaymentReturnUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}

	if (parsed.protocol !== `${ZEPRA_PAYMENT_URL_SCHEME}:`) return;
	if (!parsed.pathname.startsWith("/payment")) return;

	const sessionId = parsed.searchParams.get("session_id");
	if (!sessionId) return;

	if (parsed.pathname.includes("cancel")) {
		markCheckoutCancelled(sessionId);
		return;
	}

	if (parsed.pathname.includes("success")) {
		void completePaidCheckout(sessionId).catch(() => {
			/* waitForMigrationCheckout will poll Stripe */
		});
	}
}

async function completePaidCheckout(
	sessionId: string,
): Promise<MigrationCheckoutWaitResult | null> {
	const entry = getCheckoutEntry(sessionId);
	if (!entry) return null;

	const launchTicket = await grantMigrationLaunchTicket({
		sessionId,
		tierId: entry.tierId,
		totalBytes: entry.totalBytes,
		messageCount: entry.messageCount,
		folderPaths: entry.folderPaths,
	});

	markCheckoutPaid(sessionId);
	removeCheckoutSession(sessionId);
	return {
		paid: true,
		tierId: entry.tierId,
		sessionId,
		launchTicket,
	};
}

export async function waitForMigrationCheckout(
	sessionId: string,
): Promise<MigrationCheckoutWaitResult> {
	const deadline = Date.now() + WAIT_TIMEOUT_MS;

	while (Date.now() < deadline) {
		const entry = getCheckoutEntry(sessionId);
		if (entry?.status === "cancelled") {
			removeCheckoutSession(sessionId);
			return { paid: false, error: "Payment cancelled.", cancelled: true };
		}
		if (entry?.status === "paid") {
			const granted = await completePaidCheckout(sessionId);
			if (granted?.paid) return granted;
		}

		if (isStripeConfigured()) {
			const stripe = createStripeClient();
			const session = await stripe.checkout.sessions.retrieve(sessionId);

			if (session.status === "expired") {
				removeCheckoutSession(sessionId);
				return {
					paid: false,
					error: "Checkout expired — start payment again.",
				};
			}

			if (session.payment_status === "paid") {
				const completed = await completePaidCheckout(sessionId);
				if (completed?.paid) return completed;
				return {
					paid: false,
					error: "Payment succeeded but could not issue a migration license.",
				};
			}
		}

		await Bun.sleep(POLL_INTERVAL_MS);
	}

	return {
		paid: false,
		error: "Payment timed out. Finish checkout in the browser or try again.",
	};
}
