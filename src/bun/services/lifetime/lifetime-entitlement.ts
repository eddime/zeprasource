import { LIFETIME_LICENSE_PREFIX } from "../../../shared/stripe-checkout";
import type { EntitlementStatus } from "../../../shared/lifetime-checkout";
import { loadSettings, saveSettings } from "../../db/database";
import {
	isZepraServerConfigured,
} from "../zepra-server/config";
import {
	getLifetimeCheckoutStatusOnServer,
	verifyLifetimeOnServer,
} from "../zepra-server/client";
import { getLifetimePricingCatalog } from "../stripe/lifetime-pricing-catalog";
import { isLifetimeCheckoutConfigured } from "../stripe/lifetime-checkout";

const VERIFY_CACHE_MS = 24 * 60 * 60 * 1000;

let verifyCache: { valid: boolean; at: number } | null = null;

export function readStoredLifetimeLicense(): string | null {
	const license = loadSettings().lifetimeLicense?.trim();
	if (!license?.startsWith(`${LIFETIME_LICENSE_PREFIX}.`)) {
		return null;
	}
	return license;
}

export function saveLifetimeLicense(license: string): void {
	const settings = loadSettings();
	saveSettings({
		...settings,
		lifetimeLicense: license,
		lifetimeVerifiedAt: undefined,
	});
	verifyCache = null;
}

export async function isLifetimeActive(force = false): Promise<boolean> {
	const license = readStoredLifetimeLicense();
	if (!license || !isZepraServerConfigured()) {
		return false;
	}

	if (
		!force &&
		verifyCache &&
		verifyCache.valid &&
		Date.now() - verifyCache.at < VERIFY_CACHE_MS
	) {
		return true;
	}

	try {
		await verifyLifetimeOnServer(license);
		verifyCache = { valid: true, at: Date.now() };
		const settings = loadSettings();
		saveSettings({
			...settings,
			lifetimeVerifiedAt: new Date().toISOString(),
		});
		return true;
	} catch {
		verifyCache = { valid: false, at: Date.now() };
		return false;
	}
}

export async function getEntitlementStatus(): Promise<EntitlementStatus> {
	const serverConfigured = isZepraServerConfigured();
	let lifetimeConfigured = false;
	try {
		const catalog = await getLifetimePricingCatalog();
		lifetimeConfigured = catalog.configured;
	} catch {
		lifetimeConfigured = false;
	}
	const lifetime = await isLifetimeActive();
	return {
		lifetime,
		lifetimeConfigured,
		serverConfigured,
		lifetimeCheckoutAvailable: isLifetimeCheckoutConfigured(),
	};
}

export async function waitForLifetimeCheckout(
	sessionId: string,
): Promise<{ paid: true; lifetimeLicense: string } | { paid: false; error: string }> {
	const deadline = Date.now() + 10 * 60 * 1000;

	while (Date.now() < deadline) {
		const result = await getLifetimeCheckoutStatusOnServer(sessionId);
		if (result.paid) {
			saveLifetimeLicense(result.lifetimeLicense);
			verifyCache = { valid: true, at: Date.now() };
			return {
				paid: true,
				lifetimeLicense: result.lifetimeLicense,
			};
		}
		if (result.cancelled) {
			return { paid: false, error: result.error };
		}
		await Bun.sleep(1500);
	}

	return {
		paid: false,
		error: "Payment timed out. Finish checkout in your browser or try again.",
	};
}
