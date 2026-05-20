import type { PaidMigrationTierId } from "../../../shared/stripe-checkout";

export type CheckoutRegistryStatus = "pending" | "paid" | "cancelled";

type RegistryEntry = {
	status: CheckoutRegistryStatus;
	tierId: PaidMigrationTierId;
	totalBytes: number;
	messageCount: number;
	folderPaths: string[];
	updatedAt: number;
};

const entries = new Map<string, RegistryEntry>();

export function registerCheckoutSession(
	sessionId: string,
	data: Omit<RegistryEntry, "status" | "updatedAt"> & { folderPaths: string[] },
): void {
	entries.set(sessionId, {
		...data,
		status: "pending",
		updatedAt: Date.now(),
	});
}

export function markCheckoutPaid(sessionId: string): RegistryEntry | undefined {
	const entry = entries.get(sessionId);
	if (!entry) return undefined;
	entry.status = "paid";
	entry.updatedAt = Date.now();
	return entry;
}

export function markCheckoutCancelled(sessionId: string): void {
	const entry = entries.get(sessionId);
	if (!entry) return;
	entry.status = "cancelled";
	entry.updatedAt = Date.now();
}

export function getCheckoutEntry(sessionId: string): RegistryEntry | undefined {
	return entries.get(sessionId);
}

export function removeCheckoutSession(sessionId: string): void {
	entries.delete(sessionId);
}
