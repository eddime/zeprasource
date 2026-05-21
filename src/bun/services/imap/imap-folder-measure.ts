import { ImapFlow } from "imapflow";
import type { FolderSizeEstimate, MailboxCredentials } from "../../../shared/types";
import { connectImapClient, safeCloseImapClient } from "./imap-client";
import { formatImapError, normalizeMailboxCredentials } from "./credentials";
import { statusFolderBytes } from "./imap-status-size";

const SIZE_FETCH_BATCH = 3000;

type QuotaUsageSlice = { used?: number; usage?: number };

function quotaUsed(slice: QuotaUsageSlice | undefined): number | undefined {
	if (!slice) return undefined;
	const value = slice.used ?? slice.usage;
	return typeof value === "number" && value >= 0 ? value : undefined;
}

function orderPathsForFetch(
	folderPaths: string[],
	preCounts: Map<string, number>,
	priorityPaths?: string[],
): string[] {
	const priority = new Set(priorityPaths ?? []);
	const prioritized = folderPaths.filter((path) => priority.has(path));
	const rest = folderPaths
		.filter((path) => !priority.has(path))
		.sort((a, b) => (preCounts.get(a) ?? 0) - (preCounts.get(b) ?? 0));
	return [...prioritized, ...rest];
}

async function resolveMessageCounts(
	client: ImapFlow,
	folderPaths: string[],
	knownMessageCounts?: Record<string, number>,
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	const needLookup: string[] = [];

	for (const path of folderPaths) {
		const known = knownMessageCounts?.[path];
		if (typeof known === "number") {
			counts.set(path, known);
		} else {
			needLookup.push(path);
		}
	}

	if (needLookup.length === 0) return counts;

	const wanted = new Set(needLookup);
	for (const box of await client.list({ statusQuery: { messages: true } })) {
		if (!wanted.has(box.path)) continue;
		if (typeof box.status?.messages === "number") {
			counts.set(box.path, box.status.messages);
		}
	}

	for (const path of needLookup) {
		if (counts.has(path)) continue;
		try {
			const status = await client.status(path, { messages: true });
			counts.set(path, status.messages ?? 0);
		} catch {
			counts.set(path, 0);
		}
	}

	return counts;
}

async function sumFetchSizes(
	client: ImapFlow,
	folderPath: string,
	expectedMessages: number,
): Promise<FolderSizeEstimate> {
	const lock = await client.getMailboxLock(folderPath);
	try {
		let messages = 0;
		let bytes = 0;

		for await (const msg of client.fetch(
			{ all: true },
			{ size: true },
			{ uid: true },
		)) {
			messages += 1;
			bytes += msg.size ?? 0;
		}

		if (messages === expectedMessages) {
			return { path: folderPath, messages: expectedMessages, bytes };
		}

		const uids = await client.search({ all: true }, { uid: true });
		const uidList = Array.isArray(uids) ? uids : [];
		messages = 0;
		bytes = 0;

		for (let i = 0; i < uidList.length; i += SIZE_FETCH_BATCH) {
			const batch = uidList.slice(i, i + SIZE_FETCH_BATCH);
			for await (const msg of client.fetch(batch, { size: true }, { uid: true })) {
				messages += 1;
				bytes += msg.size ?? 0;
			}
		}

		return { path: folderPath, messages: uidList.length, bytes };
	} finally {
		lock.release();
	}
}

async function tryMailboxQuotaBytes(
	client: ImapFlow,
	folderPath: string,
	messageCount: number,
	storageClaimed: Map<number, string>,
): Promise<FolderSizeEstimate | null> {
	if (!client.capabilities.has("QUOTA") || messageCount <= 0) return null;

	const quota = await client.getQuota(folderPath);
	if (!quota || quota === false) return null;

	const storageBytes = quotaUsed(quota.storage);
	if (storageBytes === undefined) return null;

	const quotaMessages = quotaUsed(quota.messages);
	if (quotaMessages !== undefined && quotaMessages !== messageCount) return null;

	const otherPath = storageClaimed.get(storageBytes);
	if (otherPath !== undefined && otherPath !== folderPath) return null;
	storageClaimed.set(storageBytes, folderPath);

	return { path: folderPath, messages: messageCount, bytes: storageBytes };
}

async function tryFastExactBytes(
	client: ImapFlow,
	folderPath: string,
	messageCount: number,
	storageClaimed: Map<number, string>,
): Promise<FolderSizeEstimate | null> {
	if (messageCount <= 0) {
		return { path: folderPath, messages: 0, bytes: 0 };
	}

	try {
		const statusSize = await statusFolderBytes(client, folderPath);
		// Reject 0 when messages exist — unsupported servers may not return SIZE.
		if (statusSize !== null && statusSize > 0) {
			return { path: folderPath, messages: messageCount, bytes: statusSize };
		}
	} catch {
		/* STATUS=SIZE optional — fall through to QUOTA / FETCH */
	}

	return tryMailboxQuotaBytes(client, folderPath, messageCount, storageClaimed);
}

export type MeasureFolderSizesOptions = {
	/** Measure these paths first (e.g. user-selected folders). */
	priorityPaths?: string[];
	/** From Step 1 connect — avoids ~N STATUS calls in Step 2. */
	knownMessageCounts?: Record<string, number>;
};

export async function measureFolderSizes(
	raw: MailboxCredentials,
	folderPaths: string[],
	onFolder?: (folder: FolderSizeEstimate) => void,
	options?: MeasureFolderSizesOptions,
): Promise<FolderSizeEstimate[]> {
	const credentials = normalizeMailboxCredentials(raw);
	if (folderPaths.length === 0) return [];

	const client = await connectImapClient(credentials, "test");
	const storageClaimed = new Map<number, string>();

	try {
		const preCounts = await resolveMessageCounts(
			client,
			folderPaths,
			options?.knownMessageCounts,
		);
		const ordered = orderPathsForFetch(
			folderPaths,
			preCounts,
			options?.priorityPaths,
		);

		const byPath = new Map<string, FolderSizeEstimate>();
		const record = (row: FolderSizeEstimate) => {
			byPath.set(row.path, row);
			onFolder?.(row);
		};

		const needFetch: string[] = [];

		for (const path of ordered) {
			const messageCount = preCounts.get(path) ?? 0;
			if (messageCount === 0) {
				record({ path, messages: 0, bytes: 0 });
				continue;
			}

			const fast = await tryFastExactBytes(
				client,
				path,
				messageCount,
				storageClaimed,
			);
			if (fast) {
				record(fast);
				continue;
			}
			needFetch.push(path);
		}

		for (const path of needFetch) {
			const messageCount = preCounts.get(path) ?? 0;
			try {
				record(await sumFetchSizes(client, path, messageCount));
			} catch {
				record({ path, messages: messageCount, bytes: 0 });
			}
		}

		return folderPaths.map(
			(path) =>
				byPath.get(path) ?? {
					path,
					messages: preCounts.get(path) ?? 0,
					bytes: 0,
				},
		);
	} catch (error) {
		throw new Error(formatImapError(error, credentials));
	} finally {
		await safeCloseImapClient(client);
	}
}
