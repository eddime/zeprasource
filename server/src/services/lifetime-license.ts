import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getLicenseSigningSecret } from "../config";

const LICENSE_VERSION = 1;
export const LIFETIME_LICENSE_PREFIX = "zepra_lt";

export type LifetimeLicensePayload = {
	v: typeof LICENSE_VERSION;
	kind: "lifetime";
	jti: string;
	/** Stripe Checkout Session id at purchase time. */
	sid: string;
	iat: number;
};

function encodePayload(payload: LifetimeLicensePayload): string {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(encodedPayload: string): string {
	return createHmac("sha256", getLicenseSigningSecret())
		.update(encodedPayload)
		.digest("base64url");
}

export function issueLifetimeLicense(stripeSessionId: string): string {
	const payload: LifetimeLicensePayload = {
		v: LICENSE_VERSION,
		kind: "lifetime",
		jti: randomUUID(),
		sid: stripeSessionId,
		iat: Date.now(),
	};
	const body = encodePayload(payload);
	return `${LIFETIME_LICENSE_PREFIX}.${body}.${sign(body)}`;
}

export function parseLifetimeLicense(license: string): LifetimeLicensePayload {
	const parts = license.split(".");
	if (parts.length !== 3 || parts[0] !== LIFETIME_LICENSE_PREFIX) {
		throw new Error("Invalid lifetime license.");
	}
	const [, body, sig] = parts;
	const expected = sign(body);
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new Error("Lifetime license signature is invalid.");
	}
	const payload = JSON.parse(
		Buffer.from(body, "base64url").toString("utf8"),
	) as LifetimeLicensePayload;
	if (payload.v !== LICENSE_VERSION || payload.kind !== "lifetime") {
		throw new Error("Unsupported lifetime license.");
	}
	return payload;
}
