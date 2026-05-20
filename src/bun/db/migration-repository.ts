import type {
	FolderMapping,
	MigrationProgress,
	MigrationRecord,
	MigrationStatus,
} from "../../shared/types";
import type { Database } from "bun:sqlite";
import { getDatabase } from "./database";

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
	const messagesTotal = Math.max(
		existing.messages_total,
		folders.messages_total,
		messagesCompleted + messagesFailed,
	);

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

export function getMigrationById(id: string): MigrationRecord | null {
	const database = getDatabase();
	const row = database
		.query(
			`SELECT id, source_email, dest_email, status, folders_total, folders_completed,
        messages_total, messages_completed, messages_failed, bytes_transferred,
        created_at, completed_at, error
       FROM migrations WHERE id = ?`,
		)
		.get(id) as {
		id: string;
		source_email: string;
		dest_email: string;
		status: MigrationStatus;
		folders_total: number;
		folders_completed: number;
		messages_total: number;
		messages_completed: number;
		messages_failed: number;
		bytes_transferred: number;
		created_at: string;
		completed_at: string | null;
		error: string | null;
	} | null;

	if (!row) return null;

	return {
		id: row.id,
		sourceEmail: row.source_email,
		destEmail: row.dest_email,
		status: row.status,
		foldersTotal: row.folders_total,
		foldersCompleted: row.folders_completed,
		messagesTotal: row.messages_total,
		messagesCompleted: row.messages_completed,
		messagesFailed: row.messages_failed,
		bytesTransferred: row.bytes_transferred,
		createdAt: row.created_at,
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

	return {
		migrationId: record.id,
		status: statusOverride ?? record.status,
		foldersTotal: record.foldersTotal,
		foldersCompleted: record.foldersCompleted,
		messagesTotal: record.messagesTotal,
		messagesCompleted: record.messagesCompleted,
		messagesFailed: record.messagesFailed,
		bytesTransferred: record.bytesTransferred,
		error: record.error,
		updatedAt: new Date().toISOString(),
		...extras,
	};
}

/** Seed folder rows and migration.messages_total from the folder-selection step estimates. */
export function seedMigrationFolderTotals(
	migrationId: string,
	mappings: FolderMapping[],
): number {
	const database = getDatabase();
	const insertFolder = database.prepare(
		`INSERT INTO migration_folders (migration_id, source_path, dest_path, status, messages_total)
     VALUES (?, ?, ?, 'pending', ?)`,
	);

	let estimatedTotal = 0;
	for (const mapping of mappings) {
		const estimate = mapping.messages ?? 0;
		estimatedTotal += estimate;
		insertFolder.run(migrationId, mapping.sourcePath, mapping.destPath, estimate);
	}

	database
		.prepare(
			`UPDATE migrations SET messages_total = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.run(estimatedTotal, migrationId);

	return estimatedTotal;
}

/** After IMAP folder scan: never lower totals (keeps folder-view estimate stable). */
export function updateFolderScannedTotal(
	migrationId: string,
	sourcePath: string,
	scannedCount: number,
): number {
	const database = getDatabase();
	const row = database
		.query(
			`SELECT messages_total FROM migration_folders
       WHERE migration_id = ? AND source_path = ?`,
		)
		.get(migrationId, sourcePath) as { messages_total: number } | null;

	const nextTotal = Math.max(row?.messages_total ?? 0, scannedCount);
	database
		.prepare(
			`UPDATE migration_folders SET messages_total = ? WHERE migration_id = ? AND source_path = ?`,
		)
		.run(nextTotal, migrationId, sourcePath);

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

	const existing = database
		.query(`SELECT messages_total FROM migrations WHERE id = ?`)
		.get(migrationId) as { messages_total: number } | null;

	const total = Math.max(existing?.messages_total ?? 0, sumRow.total);
	database
		.prepare(
			`UPDATE migrations SET messages_total = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.run(total, migrationId);

	return total;
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
): void {
	database
		.prepare(
			`INSERT INTO migration_messages (
      migration_id, source_folder, source_uid, message_id, status, size_bytes, error, retry_count, transferred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(migration_id, source_folder, source_uid) DO UPDATE SET
      status = excluded.status,
      size_bytes = excluded.size_bytes,
      message_id = excluded.message_id,
      error = excluded.error,
      retry_count = excluded.retry_count,
      transferred_at = excluded.transferred_at`,
		)
		.run(
			migrationId,
			folder,
			uid,
			messageId ?? null,
			status,
			sizeBytes,
			error ?? null,
			retryCount,
		);
}

export function markFolderCompleted(migrationId: string, sourcePath: string): void {
	const database = getDatabase();
	database
		.prepare(
			`UPDATE migration_folders SET status = 'completed', messages_completed = messages_total
       WHERE migration_id = ? AND source_path = ?`,
		)
		.run(migrationId, sourcePath);
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
