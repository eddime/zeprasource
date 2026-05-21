import { sanitizeMigrationProgress } from "../../shared/migration-progress";
import type {
	FolderMapping,
	MigrationProgress,
	MigrationRecord,
	MigrationStatus,
} from "../../shared/types";
import type { Database } from "bun:sqlite";
import { getDatabase } from "./database";
import {
	decryptString,
	encryptString,
	hashString,
} from "../services/crypto/local-secrets";

export function resetDatabaseSingleton(): void {
	// Test hook: force next getDatabase() to open a fresh file (see database.ts).
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
}

/** Reconcile migration row counters from per-message and per-folder tables. */
export function syncMigrationCounters(migrationId: string): void {
	const database = getDatabase();
	const existing = database
		.query(
			`SELECT messages_completed, messages_failed, messages_total, bytes_transferred, folders_completed
       FROM migrations WHERE id = ?`,
		)
		.get(migrationId) as {
		messages_completed: number;
		messages_failed: number;
		messages_total: number;
		bytes_transferred: number;
		folders_completed: number;
	} | null;

	if (!existing) return;

	const messages = database
		.query(
			`SELECT
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN size_bytes ELSE 0 END), 0) AS bytes
       FROM migration_messages WHERE migration_id = ?`,
		)
		.get(migrationId) as { completed: number; failed: number; bytes: number };

	const folders = database
		.query(
			`SELECT
        COALESCE(SUM(messages_total), 0) AS messages_total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS folders_completed
       FROM migration_folders WHERE migration_id = ?`,
		)
		.get(migrationId) as { messages_total: number; folders_completed: number };

	const messagesCompleted = Math.max(
		existing.messages_completed,
		messages.completed,
	);
	const messagesFailed = Math.max(existing.messages_failed, messages.failed);
	const bytesTransferred = Math.max(existing.bytes_transferred, messages.bytes);
	const foldersCompleted = Math.max(
		existing.folders_completed,
		folders.folders_completed,
	);
	const accounted = messagesCompleted + messagesFailed;
	const outstanding = countOutstandingMessages(migrationId);
	let messagesTotal = Math.max(
		existing.messages_total,
		folders.messages_total,
		accounted,
	);
	if (outstanding === 0 && accounted > 0) {
		messagesTotal = accounted;
	}

	database
		.prepare(
			`UPDATE migrations SET
        messages_completed = ?,
        messages_failed = ?,
        bytes_transferred = ?,
        messages_total = ?,
        folders_completed = ?,
        updated_at = datetime('now')
       WHERE id = ?`,
		)
		.run(
			messagesCompleted,
			messagesFailed,
			bytesTransferred,
			messagesTotal,
			foldersCompleted,
			migrationId,
		);
}

export function setUserPausedFlag(migrationId: string, paused: boolean): void {
	getDatabase()
		.prepare(`UPDATE migrations SET user_paused = ?, updated_at = datetime('now') WHERE id = ?`)
		.run(paused ? 1 : 0, migrationId);
}

export function isUserPausedMigration(migrationId: string): boolean {
	const row = getDatabase()
		.query(`SELECT user_paused FROM migrations WHERE id = ?`)
		.get(migrationId) as { user_paused: number } | null;
	return row?.user_paused === 1;
}

export function getMigrationById(id: string): MigrationRecord | null {
	const database = getDatabase();
	const row = database
		.query(
			`SELECT id, source_email, dest_email, job_type, status, folders_total, folders_completed,
        messages_total, messages_completed, messages_failed, bytes_transferred,
        created_at, started_at, completed_at, error, user_paused
       FROM migrations WHERE id = ?`,
		)
		.get(id) as {
		id: string;
		source_email: string;
		dest_email: string;
		job_type: string;
		status: MigrationStatus;
		folders_total: number;
		folders_completed: number;
		messages_total: number;
		messages_completed: number;
		messages_failed: number;
		bytes_transferred: number;
		created_at: string;
		started_at: string | null;
		completed_at: string | null;
		error: string | null;
		user_paused: number;
	} | null;

	if (!row) return null;

	return {
		id: row.id,
		sourceEmail: decryptString(row.source_email) ?? row.source_email,
		destEmail: decryptString(row.dest_email) ?? row.dest_email,
		jobType: row.job_type === "backup" ? "backup" : "migrate",
		status: row.status,
		foldersTotal: row.folders_total,
		foldersCompleted: row.folders_completed,
		messagesTotal: row.messages_total,
		messagesCompleted: row.messages_completed,
		messagesFailed: row.messages_failed,
		bytesTransferred: row.bytes_transferred,
		createdAt: row.created_at,
		startedAt: row.started_at ?? undefined,
		completedAt: row.completed_at ?? undefined,
		error: row.error ?? undefined,
	};
}

export function getMigrationProgressSnapshot(
	migrationId: string,
	statusOverride?: MigrationStatus,
	extras?: Partial<MigrationProgress>,
	options?: { reconcile?: boolean },
): MigrationProgress | null {
	if (options?.reconcile !== false) {
		syncMigrationCounters(migrationId);
	}
	const record = getMigrationById(migrationId);
	if (!record) return null;

	const userInitiatedPause =
		extras?.userInitiatedPause ??
		(record.status === "paused" && isUserPausedMigration(migrationId));

	return sanitizeMigrationProgress({
		migrationId: record.id,
		status: statusOverride ?? record.status,
		userInitiatedPause: userInitiatedPause || undefined,
		foldersTotal: record.foldersTotal,
		foldersCompleted: record.foldersCompleted,
		messagesTotal: record.messagesTotal,
		messagesCompleted: record.messagesCompleted,
		messagesFailed: record.messagesFailed,
		bytesTransferred: record.bytesTransferred,
		error: record.error,
		startedAt: record.startedAt,
		updatedAt: new Date().toISOString(),
		...extras,
	});
}

/** Seed folder rows and migration.messages_total from the folder-selection step estimates. */
export function seedMigrationFolderTotals(
	migrationId: string,
	mappings: FolderMapping[],
): number {
	const database = getDatabase();
	const insertFolder = database.prepare(
		`INSERT INTO migration_folders (
       migration_id, source_path, source_path_hash, dest_path, status, messages_total
     ) VALUES (?, ?, ?, ?, 'pending', ?)`,
	);

	let estimatedTotal = 0;
	for (const mapping of mappings) {
		const estimate = mapping.messages ?? 0;
		estimatedTotal += estimate;
		insertFolder.run(
			migrationId,
			encryptString(mapping.sourcePath),
			hashString(`migration-folder:${migrationId}`, mapping.sourcePath),
			encryptString(mapping.destPath),
			estimate,
		);
	}

	database
		.prepare(
			`UPDATE migrations SET messages_total = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.run(estimatedTotal, migrationId);

	return estimatedTotal;
}

/** Messages in scanned folders not yet marked completed or failed. */
export function countOutstandingMessages(migrationId: string): number {
	const database = getDatabase();
	const folders = database
		.query(
			`SELECT messages_total, source_path, source_path_hash
       FROM migration_folders WHERE migration_id = ?`,
		)
		.all(migrationId) as Array<{
		messages_total: number;
		source_path: string;
		source_path_hash: string;
	}>;

	let outstanding = 0;
	for (const folder of folders) {
		const touched = database
			.query(
				`SELECT COUNT(*) AS n FROM migration_messages
         WHERE migration_id = ?
           AND (source_folder_hash = ? OR source_folder = ?)
           AND status IN ('completed', 'failed')`,
			)
			.get(migrationId, folder.source_path_hash, folder.source_path) as { n: number };
		outstanding += Math.max(0, folder.messages_total - touched.n);
	}
	return outstanding;
}

/** After IMAP folder scan: use server truth (can be lower than pre-migration estimate). */
export function updateFolderScannedTotal(
	migrationId: string,
	sourcePath: string,
	scannedCount: number,
): number {
	const database = getDatabase();
	const row = database
		.query(
			`SELECT messages_total FROM migration_folders
       WHERE migration_id = ? AND (source_path_hash = ? OR source_path = ?)`,
		)
		.get(
			migrationId,
			hashString(`migration-folder:${migrationId}`, sourcePath),
			sourcePath,
		) as { messages_total: number } | null;

	const nextTotal = scannedCount;
	database
		.prepare(
			`UPDATE migration_folders
       SET messages_total = ?
       WHERE migration_id = ? AND (source_path_hash = ? OR source_path = ?)`,
		)
		.run(
			nextTotal,
			migrationId,
			hashString(`migration-folder:${migrationId}`, sourcePath),
			sourcePath,
		);

	return refreshMigrationMessagesTotal(migrationId);
}

export function refreshMigrationMessagesTotal(migrationId: string): number {
	const database = getDatabase();
	const sumRow = database
		.query(
			`SELECT COALESCE(SUM(messages_total), 0) AS total
       FROM migration_folders WHERE migration_id = ?`,
		)
		.get(migrationId) as { total: number };

	const accounted = database
		.query(
			`SELECT
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
       FROM migration_messages WHERE migration_id = ?`,
		)
		.get(migrationId) as { completed: number; failed: number };

	const total = Math.max(sumRow.total, accounted.completed + accounted.failed);
	database
		.prepare(
			`UPDATE migrations SET messages_total = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.run(total, migrationId);

	return total;
}

/** UIDs scanned on the server but never written to migration_messages. */
export function markMissingFolderMessagesFailed(
	migrationId: string,
	sourcePath: string,
	scannedUids: number[],
): number {
	const database = getDatabase();
	const folderHash = hashString(`migration-message-folder:${migrationId}`, sourcePath);
	let marked = 0;

	for (const uid of scannedUids) {
		const row = database
			.query(
				`SELECT status FROM migration_messages
         WHERE migration_id = ?
           AND (source_folder_hash = ? OR source_folder = ?)
           AND source_uid = ?`,
			)
			.get(migrationId, folderHash, sourcePath, uid) as { status: string } | null;

		if (row) continue;

		markMigrationMessage(
			database,
			migrationId,
			sourcePath,
			uid,
			"failed",
			0,
			undefined,
			"Not transferred — will retry",
			0,
		);
		marked += 1;
	}

	if (marked > 0) syncMigrationCounters(migrationId);
	return marked;
}

export function listFailedUidsForFolder(
	migrationId: string,
	sourcePath: string,
): number[] {
	const database = getDatabase();
	const rows = database
		.query(
			`SELECT source_uid FROM migration_messages
       WHERE migration_id = ?
         AND status = 'failed'
         AND (source_folder_hash = ? OR source_folder = ?)
       ORDER BY source_uid`,
		)
		.all(
			migrationId,
			hashString(`migration-message-folder:${migrationId}`, sourcePath),
			sourcePath,
		) as Array<{ source_uid: number }>;
	return rows.map((row) => row.source_uid);
}

export function incrementMigrationCounters(
	migrationId: string,
	delta: { completed?: number; failed?: number; bytes?: number },
): void {
	const database = getDatabase();
	if (delta.completed) {
		database
			.prepare(
				`UPDATE migrations SET
          messages_completed = messages_completed + ?,
          bytes_transferred = bytes_transferred + ?,
          updated_at = datetime('now')
         WHERE id = ?`,
			)
			.run(delta.completed, delta.bytes ?? 0, migrationId);
	}
	if (delta.failed) {
		database
			.prepare(
				`UPDATE migrations SET
          messages_failed = messages_failed + ?,
          updated_at = datetime('now')
         WHERE id = ?`,
			)
			.run(delta.failed, migrationId);
	}
}

export function markMigrationMessage(
	database: Database,
	migrationId: string,
	folder: string,
	uid: number,
	status: string,
	sizeBytes: number,
	messageId?: string,
	error?: string,
	retryCount = 0,
	contentSha256?: string | null,
): void {
	database
		.prepare(
			`INSERT INTO migration_messages (
      migration_id, source_folder, source_folder_hash, source_uid, message_id, status, size_bytes, error, retry_count, content_sha256, transferred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(migration_id, source_folder_hash, source_uid) DO UPDATE SET
      status = excluded.status,
      size_bytes = excluded.size_bytes,
      message_id = excluded.message_id,
      error = excluded.error,
      retry_count = excluded.retry_count,
      content_sha256 = COALESCE(excluded.content_sha256, migration_messages.content_sha256),
      transferred_at = excluded.transferred_at`,
		)
		.run(
			migrationId,
			encryptString(folder),
			hashString(`migration-message-folder:${migrationId}`, folder),
			uid,
			encryptString(messageId ?? null),
			status,
			sizeBytes,
			encryptString(error ?? null),
			retryCount,
			contentSha256 ?? null,
		);
}

/** UIDs already on disk in turbo staging — upload only, no re-FETCH. */
export function listStagedUidsForFolder(
	migrationId: string,
	sourceFolder: string,
): number[] {
	return listStagedUidsForFolderBySize(migrationId, sourceFolder).map((r) => r.uid);
}

/** Staged UIDs smallest-first — warms up the connection before large APPENDs. */
export function listStagedUidsForFolderBySize(
	migrationId: string,
	sourceFolder: string,
): Array<{ uid: number; sizeBytes: number }> {
	const database = getDatabase();
	const folderHash = hashString(`migration-message-folder:${migrationId}`, sourceFolder);
	const rows = database
		.query(
			`SELECT source_uid, size_bytes FROM migration_messages
       WHERE migration_id = ? AND status = 'staged'
         AND (source_folder_hash = ? OR source_folder = ?)
       ORDER BY size_bytes ASC, source_uid ASC`,
		)
		.all(migrationId, folderHash, sourceFolder) as Array<{
		source_uid: number;
		size_bytes: number;
	}>;
	return rows.map((r) => ({ uid: r.source_uid, sizeBytes: r.size_bytes }));
}

export function markFolderCompleted(migrationId: string, sourcePath: string): void {
	const database = getDatabase();
	database
		.prepare(
			`UPDATE migration_folders SET status = 'completed', messages_completed = messages_total
       WHERE migration_id = ? AND (source_path_hash = ? OR source_path = ?)`,
		)
		.run(
			migrationId,
			hashString(`migration-folder:${migrationId}`, sourcePath),
			sourcePath,
		);
}

export function setMigrationStatus(
	migrationId: string,
	status: MigrationStatus,
	error?: string | null,
): void {
	const database = getDatabase();
	if (status === "completed" || status === "cancelled") {
		database
			.prepare(
				`UPDATE migrations SET status = ?, error = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
			)
			.run(status, error ?? null, migrationId);
		return;
	}
	database
		.prepare(
			`UPDATE migrations SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.run(status, error ?? null, migrationId);
}
