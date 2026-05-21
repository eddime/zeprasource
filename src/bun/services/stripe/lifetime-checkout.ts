import type {
	LifetimeCheckoutCreateResult,
	LifetimeCheckoutWaitResult,
} from "../../../shared/lifetime-checkout";
import { isMigrationCheckoutConfigured } from "./migration-checkout";
import { isZepraServerConfigured } from "../zepra-server/config";
import { createLifetimeCheckoutOnServer } from "../zepra-server/client";
import { waitForLifetimeCheckout as waitLifetime } from "../lifetime/lifetime-entitlement";
import {
	ZEPRA_PAYMENT_URL_SCHEME,
} from "./stripe-config";

export function isLifetimeCheckoutConfigured(): boolean {
	return isZepraServerConfigured() && isMigrationCheckoutConfigured();
}

export async function createLifetimeCheckout(): Promise<LifetimeCheckoutCreateResult> {
	if (!isZepraServerConfigured()) {
		return { configured: false, reason: "server_not_configured" };
	}
	if (!isMigrationCheckoutConfigured()) {
		return { configured: false, reason: "stripe_not_configured" };
	}

	const session = await createLifetimeCheckoutOnServer();
	return {
		configured: true,
		sessionId: session.sessionId,
		checkoutUrl: session.checkoutUrl,
	};
}

export function handleLifetimePaymentReturnUrl(url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}

	if (parsed.protocol !== `${ZEPRA_PAYMENT_URL_SCHEME}:`) return;
	if (!parsed.pathname.includes("/payment/lifetime")) return;

	const sessionId = parsed.searchParams.get("session_id");
	if (!sessionId) return;

	if (parsed.pathname.includes("cancel")) {
		return;
	}

	if (parsed.pathname.includes("success")) {
		void waitLifetime(sessionId).catch(() => {
			/* UI polls waitForLifetimeCheckout */
		});
	}
}

export async function waitForLifetimeCheckout(
	sessionId: string,
): Promise<LifetimeCheckoutWaitResult> {
	const result = await waitLifetime(sessionId);
	if (result.paid) {
		return {
			paid: true,
			sessionId,
			lifetimeLicense: result.lifetimeLicense,
		};
	}
	return {
		paid: false,
		error: result.error,
	};
}
