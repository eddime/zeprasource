/** In-memory launch tickets keyed by Stripe Checkout Session ID. */

type StoredLicense = {
	launchTicket: string;
	issuedAt: number;
};

const licensesBySessionId = new Map<string, StoredLicense>();
const consumedSessionIds = new Set<string>();

export function storeLaunchTicket(
	sessionId: string,
	launchTicket: string,
): void {
	if (consumedSessionIds.has(sessionId)) return;
	licensesBySessionId.set(sessionId, {
		launchTicket,
		issuedAt: Date.now(),
	});
}

export function getLaunchTicket(sessionId: string): string | null {
	return licensesBySessionId.get(sessionId)?.launchTicket ?? null;
}

export function markSessionConsumed(sessionId: string): void {
	consumedSessionIds.add(sessionId);
	licensesBySessionId.delete(sessionId);
}

export function isSessionConsumed(sessionId: string): boolean {
	return consumedSessionIds.has(sessionId);
}

/** For tests */
export function clearSessionStore(): void {
	licensesBySessionId.clear();
	consumedSessionIds.clear();
}
