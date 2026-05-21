import Stripe from "stripe";
import { hashFolderSelection } from "../../../shared/migration-payment";
import {
	billableGigabytes,
	requiresPaidPlan,
} from "../../../shared/pricing";
import { parseFreeMigrationGb } from "../../../shared/stripe-migration-catalog";
import { getDatabase } from "../../db/database";
import {
	issueMigrationLaunchTicket,
	parseMigrationLaunchTicket,
} from "./migration-launch-ticket";
import { isLifetimeActive } from "../lifetime/lifetime-entitlement";
import { getMigrationPricingCatalog } from "./migration-pricing-catalog";
import { getStripeSecretKey, isStripeConfigured } from "./stripe-config";
import { quantityForPriceId } from "./checkout-session-helpers";

const ENTITLEMENT_TTL_MS = 45 * 60 * 1000;

export type VerifiedLaunchLicense = {
	jti: string;
	stripeSessionId: string;
	billableGb: number;
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

function freeLimitBytesFromSessionMetadata(
	session: Stripe.Checkout.Session,
): number {
	const fromMeta = parseFreeMigrationGb(session.metadata);
	if (fromMeta != null) {
		return fromMeta * 1024 ** 3;
	}
	return 0;
}

async function resolveFreeLimitBytesForSession(
	session: Stripe.Checkout.Session,
): Promise<number> {
	const fromSession = freeLimitBytesFromSessionMetadata(session);
	if (fromSession > 0) return fromSession;

	const catalog = await getMigrationPricingCatalog();
	if (!catalog.configured) {
		throw new Error("Stripe pricing is not configured.");
	}
	return catalog.freeLimitBytes;
}

export async function verifyStripeCheckoutSessionPaid(
	sessionId: string,
	expected: {
		billableGb: number;
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

	const freeLimitBytes = await resolveFreeLimitBytesForSession(session);

	const billableGb = Number(session.metadata?.billable_gb ?? NaN);
	if (billableGb !== expected.billableGb) {
		throw new Error("Payment does not match the billed gigabytes.");
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

	if (billableGigabytes(expected.totalBytes, freeLimitBytes) !== expected.billableGb) {
		throw new Error("Payment does not match mailbox size.");
	}

	const catalog = await getMigrationPricingCatalog();
	const expectedPriceId = catalog.priceId;
	const metadataPriceId = session.metadata?.stripe_price_id ?? null;
	const lineItems = session.line_items?.data ?? [];

	if (!expectedPriceId) {
		throw new Error("Stripe per-GB price is not configured.");
	}

	const quantity = quantityForPriceId(lineItems, expectedPriceId);
	if (quantity !== expected.billableGb) {
		throw new Error("Stripe quantity does not match billed gigabytes.");
	}

	if (metadataPriceId && metadataPriceId !== expectedPriceId) {
		throw new Error("Checkout metadata does not match the per-GB price.");
	}
}

/** After Stripe checkout — issues a signed launch ticket (the only client-facing license). */
export async function grantMigrationLaunchTicket(input: {
	sessionId: string;
	billableGb: number;
	totalBytes: number;
	messageCount: number;
	folderPaths: string[];
}): Promise<string> {
	const folderPathsHash = hashFolderSelection(input.folderPaths);

	await verifyStripeCheckoutSessionPaid(input.sessionId, {
		billableGb: input.billableGb,
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
		billableGb: input.billableGb,
		totalBytes: input.totalBytes,
		messageCount: input.messageCount,
		folderPathsHash,
		expiresAtMs: Date.now() + ENTITLEMENT_TTL_MS,
	});
}

export async function verifyMigrationLaunchTicket(input: {
	launchTicket: string;
	folderPaths: string[];
	totalBytes: number;
	messageCount: number;
}): Promise<VerifiedLaunchLicense> {
	const catalog = await getMigrationPricingCatalog();
	if (!catalog.configured) {
		throw new Error("Paid migrations require Stripe pricing.");
	}

	if (!requiresPaidPlan(input.totalBytes, catalog.freeLimitBytes)) {
		throw new Error("Migration license is not required for this size.");
	}
	if (!isStripeConfigured()) {
		throw new Error("Paid migrations require Stripe.");
	}

	const payload = parseMigrationLaunchTicket(input.launchTicket);
	const folderPathsHash = hashFolderSelection(input.folderPaths);
	const expectedGb = billableGigabytes(
		input.totalBytes,
		catalog.freeLimitBytes,
	);

	if (
		payload.bytes !== input.totalBytes ||
		payload.msgs !== input.messageCount ||
		payload.fhash !== folderPathsHash
	) {
		throw new Error(
			"License does not match the current folder selection or mailbox size.",
		);
	}

	if (payload.gb !== expectedGb) {
		throw new Error("License does not match the billed gigabytes.");
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
		billableGb: payload.gb,
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
	const catalog = await getMigrationPricingCatalog();
	if (!catalog.configured) {
		throw new Error("Stripe pricing is not configured.");
	}

	if (!requiresPaidPlan(input.totalBytes, catalog.freeLimitBytes)) {
		return null;
	}

	if (await isLifetimeActive()) {
		return null;
	}
	if (!input.launchTicket?.trim()) {
		throw new Error("Payment is required before starting this migration.");
	}

	const license = await verifyMigrationLaunchTicket({
		launchTicket: input.launchTicket,
		folderPaths: input.folderPaths,
		totalBytes: input.totalBytes,
		messageCount: input.messageCount,
	});

	await verifyStripeCheckoutSessionPaid(license.stripeSessionId, {
		billableGb: license.billableGb,
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

	const catalog = await getMigrationPricingCatalog();
	const freeLimitBytes = catalog.configured
		? catalog.freeLimitBytes
		: 2 * 1024 ** 3;

	const licensedBytes = row.licensed_total_bytes ?? 0;
	if (licensedBytes <= freeLimitBytes) {
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
