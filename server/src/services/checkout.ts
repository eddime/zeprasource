import type Stripe from "stripe";
import { paymentReturnBase } from "../config";
import { hashFolderSelection } from "../shared/migration-payment";
import { assertBillableGbMatchesEstimate } from "../shared/pricing";
import type { MigrationCheckoutCreateBody } from "../shared/stripe-checkout";
import {
	MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES,
	STRIPE_CHECKOUT_PRICING_MODEL_PER_GB,
} from "../shared/stripe-checkout";
import { buildMigrationLifetimeOptionalItems } from "./migration-checkout-optional";
import { issueLifetimeFromStripeSession } from "./lifetime-checkout";
import { createStripeClient, isStripeConfigured } from "../stripe-client";
import { issueMigrationLaunchTicket } from "./launch-ticket";
import { getMigrationPricingCatalog } from "./pricing-catalog";
import {
	getLaunchTicket,
	isSessionConsumed,
	storeLaunchTicket,
} from "./session-store";

export type CheckoutSessionResponse = {
	sessionId: string;
	checkoutUrl: string;
};

export type CheckoutStatusResponse =
	| {
			status: "pending";
			sessionId: string;
	  }
	| {
			status: "paid";
			sessionId: string;
			billableGb: number;
			launchTicket: string;
			/** Present when the customer added Zepra Lifetime in the same checkout. */
			lifetimeLicense?: string;
	  }
	| {
			status: "expired" | "cancelled";
			sessionId: string;
			error: string;
	  };

function readPaidMetadata(session: Stripe.Checkout.Session): {
	billableGb: number;
	totalBytes: number;
	messageCount: number;
	folderPathsHash: string;
} | null {
	const billableGb = Number(session.metadata?.billable_gb ?? NaN);
	const totalBytes = Number(session.metadata?.total_bytes ?? NaN);
	const messageCount = Number(session.metadata?.message_count ?? NaN);
	const folderPathsHash = session.metadata?.folder_paths_hash ?? "";
	if (
		!Number.isFinite(billableGb) ||
		billableGb < 1 ||
		!Number.isFinite(totalBytes) ||
		!Number.isFinite(messageCount) ||
		!folderPathsHash
	) {
		return null;
	}
	return { billableGb, totalBytes, messageCount, folderPathsHash };
}

export async function createCheckoutSession(
	body: MigrationCheckoutCreateBody,
): Promise<CheckoutSessionResponse> {
	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured on the server.");
	}

	const catalog = await getMigrationPricingCatalog();
	if (!catalog.configured || !catalog.priceId) {
		throw new Error("Stripe migration pricing is not configured.");
	}

	assertBillableGbMatchesEstimate(
		body.billableGb,
		body.totalBytes,
		catalog.freeLimitBytes,
	);

	const stripe = createStripeClient();
	const folderPathsHash = hashFolderSelection(body.folderPaths);
	const base = paymentReturnBase();

	const optionalItems = await buildMigrationLifetimeOptionalItems();
	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		payment_method_types: [...MIGRATION_CHECKOUT_PAYMENT_METHOD_TYPES],
		line_items: [{ price: catalog.priceId, quantity: body.billableGb }],
		...(optionalItems ? { optional_items: optionalItems } : {}),
		success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${base}/cancel?session_id={CHECKOUT_SESSION_ID}`,
		metadata: {
			pricing_model: STRIPE_CHECKOUT_PRICING_MODEL_PER_GB,
			billable_gb: String(body.billableGb),
			total_bytes: String(body.totalBytes),
			message_count: String(body.messageCount),
			folder_count: String(body.folderCount),
			folder_paths_hash: folderPathsHash,
			free_migration_gb: String(catalog.freeLimitGb),
			stripe_price_id: catalog.priceId,
			...(optionalItems ? { lifetime_upsell: "1" } : {}),
		},
	});

	if (!session.url || !session.id) {
		throw new Error("Stripe did not return a checkout URL.");
	}

	return { sessionId: session.id, checkoutUrl: session.url };
}

async function lifetimeLicenseFromSession(
	session: Stripe.Checkout.Session,
): Promise<string | undefined> {
	const license = await issueLifetimeFromStripeSession(session);
	return license ?? undefined;
}

async function issueTicketFromStripeSession(
	session: Stripe.Checkout.Session,
): Promise<string | null> {
	if (session.payment_status !== "paid" || !session.id) return null;
	if (isSessionConsumed(session.id)) {
		throw new Error("This payment was already used for a migration.");
	}

	const existing = getLaunchTicket(session.id);
	if (existing) return existing;

	const meta = readPaidMetadata(session);
	if (!meta) return null;

	const launchTicket = issueMigrationLaunchTicket({
		stripeSessionId: session.id,
		billableGb: meta.billableGb,
		totalBytes: meta.totalBytes,
		messageCount: meta.messageCount,
		folderPathsHash: meta.folderPathsHash,
	});

	storeLaunchTicket(session.id, launchTicket);
	return launchTicket;
}

export async function fulfillCheckoutSession(
	sessionId: string,
): Promise<string | null> {
	const stripe = createStripeClient();
	const session = await stripe.checkout.sessions.retrieve(sessionId, {
		expand: ["line_items.data.price"],
	});
	return issueTicketFromStripeSession(session);
}

export async function getCheckoutStatus(
	sessionId: string,
): Promise<CheckoutStatusResponse> {
	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured on the server.");
	}

	if (isSessionConsumed(sessionId)) {
		return {
			status: "expired",
			sessionId,
			error: "This payment was already used for a migration.",
		};
	}

	const cached = getLaunchTicket(sessionId);
	if (cached) {
		const stripe = createStripeClient();
		const session = await stripe.checkout.sessions.retrieve(sessionId);
		const meta = readPaidMetadata(session);
		if (!meta) {
			return {
				status: "pending",
				sessionId,
			};
		}
		const lifetimeLicense = await lifetimeLicenseFromSession(session);
		return {
			status: "paid",
			sessionId,
			billableGb: meta.billableGb,
			launchTicket: cached,
			...(lifetimeLicense ? { lifetimeLicense } : {}),
		};
	}

	const stripe = createStripeClient();
	const session = await stripe.checkout.sessions.retrieve(sessionId);

	if (session.status === "expired") {
		return {
			status: "expired",
			sessionId,
			error: "Checkout expired — start payment again.",
		};
	}

	if (session.status === "open" && session.payment_status !== "paid") {
		return { status: "pending", sessionId };
	}

	if (session.payment_status === "paid") {
		const launchTicket = await issueTicketFromStripeSession(session);
		const meta = readPaidMetadata(session);
		if (!launchTicket || !meta) {
			return {
				status: "pending",
				sessionId,
			};
		}
		const lifetimeLicense = await lifetimeLicenseFromSession(session);
		return {
			status: "paid",
			sessionId,
			billableGb: meta.billableGb,
			launchTicket,
			...(lifetimeLicense ? { lifetimeLicense } : {}),
		};
	}

	return {
		status: "cancelled",
		sessionId,
		error: "Payment was not completed.",
	};
}

export async function handleCheckoutCompletedWebhook(
	session: Stripe.Checkout.Session,
): Promise<void> {
	if (!session.id) return;
	await issueTicketFromStripeSession(session);
}
