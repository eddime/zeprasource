import Stripe from "stripe";
import { hashFolderSelection } from "../../../shared/migration-payment";
import { FREE_MIGRATION_LIMIT_BYTES, getPricingTier, requiresPaidPlan } from "../../../shared/pricing";
import type { PaidMigrationTierId } from "../../../shared/stripe-checkout";
import { getDatabase } from "../../db/database";
import {
	issueMigrationLaunchTicket,
	parseMigrationLaunchTicket,
} from "./migration-launch-ticket";
import {
	getStripeSecretKey,
	isStripeConfigured,
	lookupKeyForTier,
} from "./stripe-config";

const ENTITLEMENT_TTL_MS = 45 * 60 * 1000;

export type VerifiedLaunchLicense = {
	jti: string;
	stripeSessionId: string;
	tierId: PaidMigrationTierId;
	totalBytes: number;
	messageCount: number;
	folderPathsHash: string;
};

function createStripeClient(): Stripe {
	const secretKey = getStripeSecretKey();
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is not configured");
	}
	return new Stripe(secretKey);
}

export async function verifyStripeCheckoutSessionPaid(
	sessionId: string,
	expected: {
		tierId: PaidMigrationTierId;
		totalBytes: number;
		messageCount: number;
		folderPathsHash: string;
	},
): Promise<void> {
	const stripe = createStripeClient();
	const session = await stripe.checkout.sessions.retrieve(sessionId, {
		expand: ["line_items.data.price"],
	});

	if (session.payment_status !== "paid") {
		throw new Error("Stripe checkout is not paid.");
	}

	const tierId = session.metadata?.tier_id;
	if (tierId !== expected.tierId) {
		throw new Error("Payment tier does not match this migration.");
	}

	const totalBytes = Number(session.metadata?.total_bytes ?? NaN);
	const messageCount = Number(session.metadata?.message_count ?? NaN);
	const folderHash = session.metadata?.folder_paths_hash ?? "";

	if (
		totalBytes !== expected.totalBytes ||
		messageCount !== expected.messageCount ||
		folderHash !== expected.folderPathsHash
	) {
		throw new Error("Payment does not match the current folder selection.");
	}

	const expectedTier = getPricingTier(expected.totalBytes);
	if (expectedTier.id !== expected.tierId) {
		throw new Error("Payment tier does not match mailbox size.");
	}

	const priceId = await resolvePriceId(stripe, expected.tierId);
	const lineItem = session.line_items?.data?.[0];
	const paidPriceId =
		typeof lineItem?.price === "object" && lineItem.price
			? lineItem.price.id
			: null;
	if (paidPriceId && paidPriceId !== priceId) {
		throw new Error("Stripe line item does not match the required plan.");
	}
}

async function resolvePriceId(
	stripe: Stripe,
	tierId: PaidMigrationTierId,
): Promise<string> {
	const prices = await stripe.prices.list({
		lookup_keys: [lookupKeyForTier(tierId)],
		limit: 1,
		active: true,
	});
	const price = prices.data[0];
	if (!price?.id) {
		throw new Error(`Stripe price missing for tier "${tierId}".`);
	}
	return price.id;
}

/** After Stripe checkout — issues a signed launch ticket (the only client-facing license). */
export async function grantMigrationLaunchTicket(input: {
	sessionId: string;
	tierId: PaidMigrationTierId;
	totalBytes: number;
	messageCount: number;
	folderPaths: string[];
}): Promise<string> {
	const folderPathsHash = hashFolderSelection(input.folderPaths);

	await verifyStripeCheckoutSessionPaid(input.sessionId, {
		tierId: input.tierId,
		totalBytes: input.totalBytes,
		messageCount: input.messageCount,
		folderPathsHash,
	});

	const db = getDatabase();
	const burned = db
		.query("SELECT jti FROM used_launch_tickets WHERE stripe_session_id = ?1")
		.get(input.sessionId) as { jti: string } | null;
	if (burned) {
		throw new Error("This payment was already used for a migration.");
	}

	return issueMigrationLaunchTicket({
		stripeSessionId: input.sessionId,
		tierId: input.tierId,
		totalBytes: input.totalBytes,
		messageCount: input.messageCount,
		folderPathsHash,
		expiresAtMs: Date.now() + ENTITLEMENT_TTL_MS,
	});
}

export function verifyMigrationLaunchTicket(input: {
	launchTicket: string;
	folderPaths: string[];
	totalBytes: number;
	messageCount: number;
}): VerifiedLaunchLicense {
	if (!requiresPaidPlan(input.totalBytes)) {
		throw new Error("Migration license is not required for this size.");
	}
	if (!isStripeConfigured()) {
		throw new Error("Paid migrations require Stripe.");
	}

	const payload = parseMigrationLaunchTicket(input.launchTicket);
	const folderPathsHash = hashFolderSelection(input.folderPaths);

	if (
		payload.bytes !== input.totalBytes ||
		payload.msgs !== input.messageCount ||
		payload.fhash !== folderPathsHash
	) {
		throw new Error(
			"License does not match the current folder selection or mailbox size.",
		);
	}

	if (getPricingTier(input.totalBytes).id !== payload.tier) {
		throw new Error("License tier does not match the current mailbox size.");
	}

	const db = getDatabase();
	const used = db
		.query("SELECT jti FROM used_launch_tickets WHERE jti = ?1")
		.get(payload.jti) as { jti: string } | null;
	if (used) {
		throw new Error("This migration license was already used.");
	}

	return {
		jti: payload.jti,
		stripeSessionId: payload.sid,
		tierId: payload.tier,
		totalBytes: payload.bytes,
		messageCount: payload.msgs,
		folderPathsHash: payload.fhash,
	};
}

/** Atomically marks the ticket used when the migration row is created. */
export function burnMigrationLaunchTicket(
	license: VerifiedLaunchLicense,
	migrationId: string,
): void {
	const db = getDatabase();
	const taken = db
		.query(
			"SELECT jti FROM used_launch_tickets WHERE jti = ?1 OR stripe_session_id = ?2 LIMIT 1",
		)
		.get(license.jti, license.stripeSessionId) as { jti: string } | null;
	if (taken) {
		throw new Error("This migration license was already used.");
	}

	db.query(
		`INSERT INTO used_launch_tickets (jti, stripe_session_id, migration_id)
		 VALUES (?1, ?2, ?3)`,
	).run(license.jti, license.stripeSessionId, migrationId);
}

export async function assertPaidMigrationCanStart(input: {
	launchTicket?: string;
	folderPaths: string[];
	totalBytes: number;
	messageCount: number;
}): Promise<VerifiedLaunchLicense | null> {
	if (!requiresPaidPlan(input.totalBytes)) {
		return null;
	}
	if (!input.launchTicket?.trim()) {
		throw new Error("Payment is required before starting this migration.");
	}

	const license = verifyMigrationLaunchTicket({
		launchTicket: input.launchTicket,
		folderPaths: input.folderPaths,
		totalBytes: input.totalBytes,
		messageCount: input.messageCount,
	});

	await verifyStripeCheckoutSessionPaid(license.stripeSessionId, {
		tierId: license.tierId,
		totalBytes: license.totalBytes,
		messageCount: license.messageCount,
		folderPathsHash: license.folderPathsHash,
	});

	return license;
}

/** Auto-resume: paid migrations must carry a Stripe session that is still paid. */
export async function assertMigrationResumeLicense(
	migrationId: string,
	folderPaths: string[],
): Promise<void> {
	const db = getDatabase();
	const row = db
		.query(
			`SELECT stripe_session_id, licensed_total_bytes, license_folder_hash
			 FROM migrations WHERE id = ?1`,
		)
		.get(migrationId) as
		| {
				stripe_session_id: string | null;
				licensed_total_bytes: number | null;
				license_folder_hash: string | null;
		  }
		| null;

	if (!row) return;

	const licensedBytes = row.licensed_total_bytes ?? 0;
	if (licensedBytes <= FREE_MIGRATION_LIMIT_BYTES) {
		return;
	}

	if (!row.stripe_session_id || !row.license_folder_hash) {
		throw new Error("This migration has no valid payment record.");
	}

	const folderPathsHash = hashFolderSelection(folderPaths);
	if (row.license_folder_hash !== folderPathsHash) {
		throw new Error("Folder selection no longer matches the paid migration.");
	}

	if (!isStripeConfigured()) {
		throw new Error("Cannot verify payment for this migration.");
	}

	const stripe = createStripeClient();
	const session = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
	if (session.payment_status !== "paid") {
		throw new Error("Stripe payment for this migration is no longer valid.");
	}
}
