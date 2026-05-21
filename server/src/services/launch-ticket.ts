import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getLicenseSigningSecret } from "../config";

const TICKET_VERSION = 1;
const TICKET_PREFIX = "zepra1";

export type MigrationLaunchTicketPayload = {
	v: typeof TICKET_VERSION;
	jti: string;
	sid: string;
	/** Billed gigabytes paid for (Stripe line item quantity). */
	gb: number;
	bytes: number;
	msgs: number;
	fhash: string;
	exp: number;
};

const ENTITLEMENT_TTL_MS = 45 * 60 * 1000;

function encodePayload(payload: MigrationLaunchTicketPayload): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(encodedPayload: string): string {
	return createHmac("sha256", getLicenseSigningSecret())
		.update(encodedPayload)
		.digest("base64url");
}

export function issueMigrationLaunchTicket(input: {
	stripeSessionId: string;
	billableGb: number;
	totalBytes: number;
	messageCount: number;
	folderPathsHash: string;
	expiresAtMs?: number;
}): string {
	const payload: MigrationLaunchTicketPayload = {
		v: TICKET_VERSION,
		jti: randomUUID(),
		sid: input.stripeSessionId,
		gb: input.billableGb,
		bytes: input.totalBytes,
		msgs: input.messageCount,
		fhash: input.folderPathsHash,
		exp: input.expiresAtMs ?? Date.now() + ENTITLEMENT_TTL_MS,
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
	const payload = JSON.parse(
		Buffer.from(body, "base64url").toString("utf8"),
	) as MigrationLaunchTicketPayload;
	if (payload.v !== TICKET_VERSION) {
		throw new Error("Unsupported migration license version.");
	}
	if (payload.exp <= Date.now()) {
		throw new Error("Migration license expired.");
	}
	return payload;
}
