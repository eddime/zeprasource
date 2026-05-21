import type { Database } from "bun:sqlite";
import type { ImapFlow } from "imapflow";
import { hashString } from "../crypto/local-secrets";
import {
	buildDestinationMessageIdIndex,
	getDestFolderMessageCount,
	loadCompletedMessageIdsFromDb,
	normalizeMessageId,
} from "./destination-message-index";

function destFolderHash(migrationId: string, destPath: string): string {
	return hashString(`migration-dest-dedup:${migrationId}`, destPath);
}

function loadCachedMessageIds(
	db: Database,
	migrationId: string,
	destPath: string,
): Set<string> | null {
	const folderHash = destFolderHash(migrationId, destPath);
	const row = db
		.query(
			`SELECT built_at FROM migration_dest_dedup_meta
       WHERE migration_id = ? AND dest_folder_hash = ?`,
		)
		.get(migrationId, folderHash) as { built_at: string } | null;
	if (!row) return null;

	const rows = db
		.query(
			`SELECT message_id FROM migration_dest_message_ids
       WHERE migration_id = ? AND dest_folder_hash = ?`,
		)
		.all(migrationId, folderHash) as Array<{ message_id: string }>;

	const ids = new Set<string>();
	for (const r of rows) {
		ids.add(r.message_id);
	}
	return ids;
}

function persistCachedMessageIds(
	db: Database,
	migrationId: string,
	destPath: string,
	ids: Set<string>,
): void {
	const folderHash = destFolderHash(migrationId, destPath);
	const insert = db.prepare(
		`INSERT OR IGNORE INTO migration_dest_message_ids
     (migration_id, dest_folder_hash, message_id) VALUES (?, ?, ?)`,
	);

	db.transaction(() => {
		db.prepare(
			`DELETE FROM migration_dest_message_ids
       WHERE migration_id = ? AND dest_folder_hash = ?`,
		).run(migrationId, folderHash);
		for (const id of ids) {
			insert.run(migrationId, folderHash, id);
		}
		db.prepare(
			`INSERT INTO migration_dest_dedup_meta (migration_id, dest_folder_hash, dest_path, built_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(migration_id, dest_folder_hash) DO UPDATE SET
         dest_path = excluded.dest_path,
         built_at = datetime('now')`,
		).run(migrationId, folderHash, destPath);
	})();
}

/**
 * Destination Message-Id index with SQLite cache (one server scan per dest folder per migration).
 */
export async function resolveDestinationDuplicateIds(options: {
	client: ImapFlow;
	folderPath: string;
	fetchBatchSize: number;
	db: Database;
	migrationId: string;
	sourceFolder: string;
}): Promise<Set<string>> {
	const fromDb = loadCompletedMessageIdsFromDb(
		options.db,
		options.migrationId,
		options.sourceFolder,
	);

	const cached = loadCachedMessageIds(options.db, options.migrationId, options.folderPath);
	if (cached) {
		for (const id of fromDb) {
			cached.add(id);
		}
		return cached;
	}

	const destCount = await getDestFolderMessageCount(options.client, options.folderPath);
	if (destCount === 0) {
		return fromDb;
	}

	const onServer = await buildDestinationMessageIdIndex(
		options.client,
		options.folderPath,
		options.fetchBatchSize,
	);
	for (const id of fromDb) {
		onServer.add(id);
	}
	persistCachedMessageIds(options.db, options.migrationId, options.folderPath, onServer);
	return onServer;
}

export { normalizeMessageId };
