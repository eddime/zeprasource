import type { ImapFlow } from "imapflow";
import { MIGRATION_FETCH_BATCH_SIZE } from "../migration/migration-constants";

export function normalizeMessageId(messageId: string): string {
	return messageId.trim().replace(/^<|>$/g, "").toLowerCase();
}

/** One-time envelope scan of the destination folder for O(1) duplicate checks. */
export async function buildDestinationMessageIdIndex(
	client: ImapFlow,
	folderPath: string,
): Promise<Set<string>> {
	const ids = new Set<string>();
	const lock = await client.getMailboxLock(folderPath);
	try {
		const uids = await client.search({ all: true }, { uid: true });
		const uidList = Array.isArray(uids) ? uids : [];
		for (let i = 0; i < uidList.length; i += MIGRATION_FETCH_BATCH_SIZE) {
			const batch = uidList.slice(i, i + MIGRATION_FETCH_BATCH_SIZE);
			for await (const msg of client.fetch(batch, { envelope: true }, { uid: true })) {
				const raw = msg.envelope?.messageId;
				if (raw) ids.add(normalizeMessageId(raw));
			}
		}
	} finally {
		lock.release();
	}
	return ids;
}
