import Stripe from "stripe";
import {
	MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES,
	type MigrationCheckoutCreateParams,
	type MigrationCheckoutCreateResult,
	type MigrationCheckoutWaitResult,
} from "../../../shared/stripe-checkout";
import { hashFolderSelection } from "../../../shared/migration-payment";
import { assertBillableGbMatchesEstimate } from "../../../shared/pricing";
import { grantMigrationLaunchTicket } from "./migration-payment-entitlements";
import {
	getStripeSecretKey,
	isStripeConfigured,
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
import { getMigrationPricingCatalog } from "./migration-pricing-catalog";

const POLL_INTERVAL_MS = 1500;
const WAIT_TIMEOUT_MS = 10 * 60 * 1000;

function createStripeClient(): Stripe {
	const secretKey = getStripeSecretKey();
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}
	return new Stripe(secretKey);
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

	const catalog = await getMigrationPricingCatalog();
	if (!catalog.configured || !catalog.priceId) {
		throw new Error(
			catalog.error === "stripe_not_configured"
				? "STRIPE_SECRET_KEY is not configured."
				: "Stripe migration pricing is not configured. Check the per-GB price and free_migration_gb metadata.",
		);
	}

	assertBillableGbMatchesEstimate(
		params.billableGb,
		params.totalBytes,
		catalog.freeLimitBytes,
	);

	const stripe = createStripeClient();
	const base = paymentReturnBase();

	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		payment_method_types: [...MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES],
		line_items: [{ price: catalog.priceId, quantity: params.billableGb }],
		success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${base}/cancel?session_id={CHECKOUT_SESSION_ID}`,
		metadata: {
			pricing_model: "per_gb",
			billable_gb: String(params.billableGb),
			total_bytes: String(params.totalBytes),
			message_count: String(params.messageCount),
			folder_count: String(params.folderCount),
			folder_paths_hash: hashFolderSelection(params.folderPaths),
			free_migration_gb: String(catalog.freeLimitGb),
			stripe_price_id: catalog.priceId,
		},
	});

	if (!session.url || !session.id) {
		throw new Error("Stripe did not return a checkout URL.");
	}

	registerCheckoutSession(session.id, {
		billableGb: params.billableGb,
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
	if (parsed.pathname.startsWith("/payment/lifetime")) return;

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
		billableGb: entry.billableGb,
		totalBytes: entry.totalBytes,
		messageCount: entry.messageCount,
		folderPaths: entry.folderPaths,
	});

	markCheckoutPaid(sessionId);
	removeCheckoutSession(sessionId);
	return {
		paid: true,
		billableGb: entry.billableGb,
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
		error: "Payment timed out. Finish checkout in your browser or try again.",
	};
}
