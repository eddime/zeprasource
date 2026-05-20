import type Stripe from "stripe";
import { paymentReturnBase } from "../config";
import { hashFolderSelection } from "../shared/migration-payment";
import { assertTierMatchesEstimate } from "../shared/pricing";
import type {
	MigrationCheckoutCreateBody,
	PaidMigrationTierId,
} from "../shared/stripe-checkout";
import {
	createStripeClient,
	isStripeConfigured,
	resolvePriceId,
} from "../stripe-client";
import { issueMigrationLaunchTicket } from "./launch-ticket";
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
			tierId: PaidMigrationTierId;
			launchTicket: string;
	  }
	| {
			status: "expired" | "cancelled";
			sessionId: string;
			error: string;
	  };

function readPaidTierMetadata(session: Stripe.Checkout.Session): {
	tierId: PaidMigrationTierId;
	totalBytes: number;
	messageCount: number;
	folderPathsHash: string;
} | null {
	const tierId = session.metadata?.tier_id as PaidMigrationTierId | undefined;
	if (
		tierId !== "starter" &&
		tierId !== "plus" &&
		tierId !== "pro"
	) {
		return null;
	}
	const totalBytes = Number(session.metadata?.total_bytes ?? NaN);
	const messageCount = Number(session.metadata?.message_count ?? NaN);
	const folderPathsHash = session.metadata?.folder_paths_hash ?? "";
	if (
		!Number.isFinite(totalBytes) ||
		!Number.isFinite(messageCount) ||
		!folderPathsHash
	) {
		return null;
	}
	return { tierId, totalBytes, messageCount, folderPathsHash };
}

export async function createCheckoutSession(
	body: MigrationCheckoutCreateBody,
): Promise<CheckoutSessionResponse> {
	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured on the server.");
	}

	assertTierMatchesEstimate(body.tierId, body.totalBytes);

	const stripe = createStripeClient();
	const priceId = await resolvePriceId(stripe, body.tierId);
	const folderPathsHash = hashFolderSelection(body.folderPaths);
	const base = paymentReturnBase();

	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		line_items: [{ price: priceId, quantity: 1 }],
		success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${base}/cancel?session_id={CHECKOUT_SESSION_ID}`,
		metadata: {
			tier_id: body.tierId,
			total_bytes: String(body.totalBytes),
			message_count: String(body.messageCount),
			folder_count: String(body.folderCount),
			folder_paths_hash: folderPathsHash,
		},
	});

	if (!session.url || !session.id) {
		throw new Error("Stripe did not return a checkout URL.");
	}

	return { sessionId: session.id, checkoutUrl: session.url };
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

	const meta = readPaidTierMetadata(session);
	if (!meta) return null;

	const launchTicket = issueMigrationLaunchTicket({
		stripeSessionId: session.id,
		tierId: meta.tierId,
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
		const meta = readPaidTierMetadata(session);
		if (!meta) {
			return {
				status: "pending",
				sessionId,
			};
		}
		return {
			status: "paid",
			sessionId,
			tierId: meta.tierId,
			launchTicket: cached,
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
		const meta = readPaidTierMetadata(session);
		if (!launchTicket || !meta) {
			return {
				status: "pending",
				sessionId,
			};
		}
		return {
			status: "paid",
			sessionId,
			tierId: meta.tierId,
			launchTicket,
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
