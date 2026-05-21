import type { ZepraPricingCatalog } from "../../../shared/lifetime-pricing-catalog";
import type {
	LifetimeCheckoutWaitResult,
	LifetimeVerifyResult,
} from "../../../shared/lifetime-checkout";
import { getZepraApiKey, getZepraServerUrl } from "./config";

export class ZepraServerError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ZepraServerError";
	}
}

async function zepraServerFetch<T>(
	path: string,
	init?: RequestInit,
): Promise<T> {
	const base = getZepraServerUrl();
	if (!base) {
		throw new Error("ZEPRA_SERVER_URL is not configured.");
	}

	const headers = new Headers(init?.headers);
	headers.set("Accept", "application/json");
	if (init?.body) {
		headers.set("Content-Type", "application/json");
	}
	const apiKey = getZepraApiKey();
	if (apiKey) {
		headers.set("X-Zepra-Api-Key", apiKey);
	}

	const response = await fetch(`${base}${path}`, {
		...init,
		headers,
	});

	const text = await response.text();
	let payload: { error?: string } | T = {} as T;
	if (text) {
		try {
			payload = JSON.parse(text) as { error?: string } | T;
		} catch {
			throw new ZepraServerError("Invalid response from Zepra Server.", response.status);
		}
	}

	if (!response.ok) {
		const message =
			typeof payload === "object" &&
			payload &&
			"error" in payload &&
			typeof payload.error === "string"
				? payload.error
				: `Zepra Server error (${response.status}).`;
		throw new ZepraServerError(message, response.status);
	}

	return payload as T;
}

export async function fetchZepraPricingCatalog(): Promise<ZepraPricingCatalog> {
	return zepraServerFetch<ZepraPricingCatalog>("/v1/pricing/catalog");
}

export async function createLifetimeCheckoutOnServer(): Promise<{
	sessionId: string;
	checkoutUrl: string;
}> {
	return zepraServerFetch("/v1/checkout/lifetime-sessions", {
		method: "POST",
		body: "{}",
	});
}

export async function getLifetimeCheckoutStatusOnServer(
	sessionId: string,
): Promise<LifetimeCheckoutWaitResult> {
	const status = await zepraServerFetch<{
		status: string;
		sessionId: string;
		lifetimeLicense?: string;
		error?: string;
	}>(`/v1/checkout/lifetime-sessions/${encodeURIComponent(sessionId)}`);

	if (status.status === "paid" && status.lifetimeLicense) {
		return {
			paid: true,
			sessionId: status.sessionId,
			lifetimeLicense: status.lifetimeLicense,
		};
	}
	if (status.status === "pending") {
		return { paid: false, error: "Payment pending." };
	}
	return {
		paid: false,
		error: status.error ?? "Payment was not completed.",
		cancelled: status.status === "cancelled",
	};
}

export async function verifyLifetimeOnServer(
	lifetimeLicense: string,
): Promise<LifetimeVerifyResult> {
	return zepraServerFetch<LifetimeVerifyResult>("/v1/lifetime/verify", {
		method: "POST",
		body: JSON.stringify({ lifetimeLicense }),
	});
}
