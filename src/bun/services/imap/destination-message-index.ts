import type { Database } from "bun:sqlite";
import type { ImapFlow } from "imapflow";
import { hashString } from "../crypto/local-secrets";

export function normalizeMessageId(messageId: string): string {
	return messageId.trim().replace(/^<|>$/g, "").toLowerCase();
}

export async function getDestFolderMessageCount(
	client: ImapFlow,
	folderPath: string,
): Promise<number> {
	const lock = await client.getMailboxLock(folderPath);
	try {
		const status = await client.status(folderPath, { messages: true });
		return status.messages ?? 0;
	} finally {
		lock.release();
	}
}

/** Message-Ids already marked completed in this migration (resume / re-run). */
export function loadCompletedMessageIdsFromDb(
	db: Database,
	migrationId: string,
	sourceFolder: string,
): Set<string> {
	const folderHash = hashString(`migration-message-folder:${migrationId}`, sourceFolder);
	const rows = db
		.query(
			`SELECT message_id FROM migration_messages
       WHERE migration_id = ? AND status = 'completed'
         AND message_id IS NOT NULL AND message_id != ''
         AND (source_folder_hash = ? OR source_folder = ?)`,
		)
		.all(migrationId, folderHash, sourceFolder) as Array<{ message_id: string }>;

	const ids = new Set<string>();
	for (const row of rows) {
		ids.add(normalizeMessageId(row.message_id));
	}
	return ids;
}

/** One-time envelope scan of the destination folder for O(1) duplicate checks. */
export async function buildDestinationMessageIdIndex(
	client: ImapFlow,
	folderPath: string,
	fetchBatchSize: number,
): Promise<Set<string>> {
	const ids = new Set<string>();
	const lock = await client.getMailboxLock(folderPath);
	try {
		const uids = await client.search({ all: true }, { uid: true });
		const uidList = Array.isArray(uids) ? uids : [];
		for (let i = 0; i < uidList.length; i += fetchBatchSize) {
			const batch = uidList.slice(i, i + fetchBatchSize);
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

export { resolveDestinationDuplicateIds } from "./destination-dedup-cache";
