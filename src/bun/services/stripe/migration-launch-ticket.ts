import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PaidMigrationTierId } from "../../../shared/stripe-checkout";
import { getStripeSecretKey } from "./stripe-config";

const TICKET_VERSION = 1;
const TICKET_PREFIX = "zepra1";

export type MigrationLaunchTicketPayload = {
	v: typeof TICKET_VERSION;
	jti: string;
	sid: string;
	tier: PaidMigrationTierId;
	bytes: number;
	msgs: number;
	fhash: string;
	exp: number;
};

function signingKey(): string {
	const key = getStripeSecretKey();
	if (!key) {
		throw new Error("STRIPE_SECRET_KEY is required to issue migration licenses.");
	}
	return key;
}

function encodePayload(payload: MigrationLaunchTicketPayload): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encoded: string): MigrationLaunchTicketPayload {
	const json = Buffer.from(encoded, "base64url").toString("utf8");
	const parsed = JSON.parse(json) as MigrationLaunchTicketPayload;
	if (parsed.v !== TICKET_VERSION) {
		throw new Error("Unsupported migration license version.");
	}
	return parsed;
}

function sign(encodedPayload: string): string {
	return createHmac("sha256", signingKey())
		.update(encodedPayload)
		.digest("base64url");
}

/** Opaque license returned to the UI after Stripe checkout — cannot be forged without the server secret. */
export function issueMigrationLaunchTicket(input: {
	stripeSessionId: string;
	tierId: PaidMigrationTierId;
	totalBytes: number;
	messageCount: number;
	folderPathsHash: string;
	expiresAtMs: number;
}): string {
	const payload: MigrationLaunchTicketPayload = {
		v: TICKET_VERSION,
		jti: randomUUID(),
		sid: input.stripeSessionId,
		tier: input.tierId,
		bytes: input.totalBytes,
		msgs: input.messageCount,
		fhash: input.folderPathsHash,
		exp: input.expiresAtMs,
	};
	const body = encodePayload(payload);
	const sig = sign(body);
	return `${TICKET_PREFIX}.${body}.${sig}`;
}

export function parseMigrationLaunchTicket(
	ticket: string,
): MigrationLaunchTicketPayload {
	const parts = ticket.split(".");
	if (parts.length !== 3 || parts[0] !== TICKET_PREFIX) {
		throw new Error("Invalid migration license.");
	}
	const [, body, sig] = parts;
	const expected = sign(body);
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new Error("Migration license signature is invalid.");
	}
	const payload = decodePayload(body);
	if (payload.exp <= Date.now()) {
		throw new Error("Migration license expired — pay again.");
	}
	return payload;
}
