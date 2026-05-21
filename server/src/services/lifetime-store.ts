import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDirectory } from "../config";

type StoredLifetime = {
	stripeSessionId: string;
	license: string;
	jti: string;
	issuedAt: string;
};

type StoreFile = {
	bySessionId: Record<string, StoredLifetime>;
	byJti: Record<string, string>;
};

const FILE_NAME = "lifetime-entitlements.json";

function storePath(): string {
	return join(getDataDirectory(), FILE_NAME);
}

function readStore(): StoreFile {
	const path = storePath();
	if (!existsSync(path)) {
		return { bySessionId: {}, byJti: {} };
	}
	try {
		return JSON.parse(readFileSync(path, "utf8")) as StoreFile;
	} catch {
		return { bySessionId: {}, byJti: {} };
	}
}

function writeStore(store: StoreFile): void {
	const path = storePath();
	mkdirSync(getDataDirectory(), { recursive: true });
	writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
}

export function storeLifetimeEntitlement(input: {
	stripeSessionId: string;
	license: string;
	jti: string;
}): void {
	const store = readStore();
	const row: StoredLifetime = {
		stripeSessionId: input.stripeSessionId,
		license: input.license,
		jti: input.jti,
		issuedAt: new Date().toISOString(),
	};
	store.bySessionId[input.stripeSessionId] = row;
	store.byJti[input.jti] = input.stripeSessionId;
	writeStore(store);
}

export function getLifetimeBySessionId(
	sessionId: string,
): StoredLifetime | null {
	return readStore().bySessionId[sessionId] ?? null;
}

export function getLifetimeByJti(jti: string): StoredLifetime | null {
	const sessionId = readStore().byJti[jti];
	if (!sessionId) return null;
	return getLifetimeBySessionId(sessionId);
}

/** For tests */
export function clearLifetimeStore(): void {
	writeStore({ bySessionId: {}, byJti: {} });
}
