import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
	FolderMapping,
	MailboxCredentials,
	MigrationProgress,
	MigrationStatus,
} from "../../../shared/types";
import { getDatabase, loadSettings } from "../../db/database";
import {
	getMigrationProgressSnapshot,
	incrementMigrationCounters,
	markFolderCompleted,
	refreshMigrationMessagesTotal,
	seedMigrationFolderTotals,
	setMigrationStatus,
	syncMigrationCounters,
	updateFolderScannedTotal,
} from "../../db/migration-repository";
import {
	loadMigrationResumePayload,
	snapshotMigrationMailboxes,
} from "./migration-resume";
import {
	createImapClient,
	safeCloseImapClient,
	ensureFolderExists,
	fetchFolderUids,
} from "../imap/imap-client";
import { transferFolderWithLanes } from "./migration-lanes";
import { logger } from "../../utils/logger";

export type ProgressEmitter = (progress: MigrationProgress) => void;

export const MAX_CONCURRENT_MIGRATIONS = 3;

export class MigrationCapacityError extends Error {
	constructor() {
		super(
			`Maximum ${MAX_CONCURRENT_MIGRATIONS} migrations can run at once. Pause one or wait for it to finish.`,
		);
		this.name = "MigrationCapacityError";
	}
}

type LiveProgressState = {
	foldersTotal: number;
	foldersCompleted: number;
	messagesTotal: number;
	messagesCompleted: number;
	messagesFailed: number;
	bytesTransferred: number;
};

function emitLiveProgress(
	emit: ProgressEmitter,
	migrationId: string,
	state: LiveProgressState,
	extras?: Partial<MigrationProgress>,
): void {
	emit({
		migrationId,
		status: "running",
		foldersTotal: state.foldersTotal,
		foldersCompleted: state.foldersCompleted,
		messagesTotal: state.messagesTotal,
		messagesCompleted: state.messagesCompleted,
		messagesFailed: state.messagesFailed,
		bytesTransferred: state.bytesTransferred,
		...extras,
		updatedAt: new Date().toISOString(),
	});
}

interface MigrationContext {
	migrationId: string;
	source: MailboxCredentials;
	destination: MailboxCredentials;
	folderMappings: FolderMapping[];
	cancelled: boolean;
	paused: boolean;
}

const activeMigrations = new Map<string, MigrationContext>();

export function getActiveMigrationIds(): string[] {
	return Array.from(activeMigrations.keys());
}

export function cancelMigration(migrationId: string): void {
	const ctx = activeMigrations.get(migrationId);
	if (ctx) ctx.cancelled = true;
	syncMigrationCounters(migrationId);
	setMigrationStatus(migrationId, "cancelled");
}

export function pauseMigration(migrationId: string): void {
	const ctx = activeMigrations.get(migrationId);
	if (ctx) ctx.paused = true;
	syncMigrationCounters(migrationId);
	setMigrationStatus(migrationId, "paused");
}

export function unpauseMigration(migrationId: string): void {
	const ctx = activeMigrations.get(migrationId);
	if (ctx) ctx.paused = false;
}

type StartMigrationParams = {
	source?: MailboxCredentials;
	destination?: MailboxCredentials;
	folderMappings?: FolderMapping[];
	resumeMigrationId?: string;
};

export async function prepareMigrationStart(
	params: StartMigrationParams,
): Promise<string> {
	const db = getDatabase();

	let migrationId = params.resumeMigrationId ?? randomUUID();
	let source = params.source;
	let destination = params.destination;
	let selectedMappings = (params.folderMappings ?? []).filter((m) => m.selected);

	if (params.resumeMigrationId) {
		const payload = loadMigrationResumePayload(params.resumeMigrationId);
		if (!payload) {
			throw new Error(
				"Migration cannot be resumed — mailbox credentials are missing. Reconnect your accounts and try again.",
			);
		}
		migrationId = payload.migrationId;
		source = payload.source;
		destination = payload.destination;
		selectedMappings = payload.folderMappings;
	} else if (!source || !destination || selectedMappings.length === 0) {
		throw new Error("Source, destination, and folder mappings are required.");
	}

	if (!params.resumeMigrationId) {
		const sourceRef = `migration/${migrationId}/source`;
		const destRef = `migration/${migrationId}/destination`;
		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, folder_mappings, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, datetime('now'), datetime('now'))`,
		).run(
			migrationId,
			sourceRef,
			destRef,
			source.email,
			destination.email,
			selectedMappings.length,
			JSON.stringify(selectedMappings),
		);

		snapshotMigrationMailboxes(migrationId, source, destination);
		seedMigrationFolderTotals(migrationId, selectedMappings);
	} else {
		snapshotMigrationMailboxes(migrationId, source, destination);
		db.prepare(
			`UPDATE migrations SET status = 'running', error = NULL, updated_at = datetime('now') WHERE id = ?`,
		).run(migrationId);
		unpauseMigration(migrationId);
	}

	return migrationId;
}

export async function executeMigration(
	migrationId: string,
	emit: ProgressEmitter,
): Promise<void> {
	if (activeMigrations.has(migrationId)) {
		return;
	}

	if (activeMigrations.size >= MAX_CONCURRENT_MIGRATIONS) {
		throw new MigrationCapacityError();
	}

	const payload = loadMigrationResumePayload(migrationId);
	if (!payload) {
		throw new Error(
			`Migration ${migrationId} cannot run — mailbox credentials are missing.`,
		);
	}

	const ctx: MigrationContext = {
		migrationId,
		source: payload.source,
		destination: payload.destination,
		folderMappings: payload.folderMappings,
		cancelled: false,
		paused: false,
	};

	activeMigrations.set(migrationId, ctx);

	const db = getDatabase();
	const settings = loadSettings();
	const { source, destination, folderMappings: selectedMappings } = ctx;

	const sourceClient = await createImapClient(source);
	const destClient = await createImapClient(destination);

	try {
		await sourceClient.connect();
		await destClient.connect();

		syncMigrationCounters(migrationId);
		const baseline = getMigrationProgressSnapshot(migrationId, "running", undefined, {
			reconcile: true,
		});

		const live: LiveProgressState = {
			foldersTotal: selectedMappings.length,
			foldersCompleted: baseline?.foldersCompleted ?? 0,
			messagesTotal: baseline?.messagesTotal ?? 0,
			messagesCompleted: baseline?.messagesCompleted ?? 0,
			messagesFailed: baseline?.messagesFailed ?? 0,
			bytesTransferred: baseline?.bytesTransferred ?? 0,
		};
		if (baseline) emit(baseline);

		for (const mapping of selectedMappings) {
			if (ctx.cancelled) break;
			while (ctx.paused) {
				await Bun.sleep(250);
				if (ctx.cancelled) break;
			}

			emitLiveProgress(emit, migrationId, live, {
				currentFolder: mapping.sourcePath,
			});

			await ensureFolderExists(destClient, mapping.destPath);

			const folderRow = db
				.query(
					"SELECT status FROM migration_folders WHERE migration_id = ? AND source_path = ?",
				)
				.get(migrationId, mapping.sourcePath) as { status: string } | null;

			if (folderRow?.status === "completed") {
				emitLiveProgress(emit, migrationId, live, {
					currentFolder: mapping.sourcePath,
				});
				continue;
			}

			db.prepare(
				`UPDATE migration_folders SET status = 'running' WHERE migration_id = ? AND source_path = ?`,
			).run(migrationId, mapping.sourcePath);

			const uids = await fetchFolderUids(sourceClient, mapping.sourcePath);
			live.messagesTotal = updateFolderScannedTotal(
				migrationId,
				mapping.sourcePath,
				uids.length,
			);

			const pendingUids = uids.filter((uid) => {
				const existing = db
					.query(
						`SELECT status FROM migration_messages
             WHERE migration_id = ? AND source_folder = ? AND source_uid = ?`,
					)
					.get(migrationId, mapping.sourcePath, uid) as { status: string } | null;
				if (!existing) return true;
				return existing.status !== "completed";
			});

			await transferFolderWithLanes({
				db,
				migrationId,
				mapping,
				sourceCreds: source,
				destCreds: destination,
				destClient,
				pendingUids,
				settings,
				markMessage,
				hooks: {
					shouldStop: () => ctx.cancelled,
					waitWhilePaused: async () => {
						while (ctx.paused) {
							await Bun.sleep(250);
							if (ctx.cancelled) return;
						}
					},
					onMessageCompleted: (uid, sizeBytes) => {
						incrementMigrationCounters(migrationId, {
							completed: 1,
							bytes: sizeBytes,
						});
						live.messagesCompleted += 1;
						live.bytesTransferred += sizeBytes;
						emitLiveProgress(emit, migrationId, live, {
							currentFolder: mapping.sourcePath,
							currentMessage: `UID ${uid}`,
						});
					},
					onMessageFailed: () => {
						live.messagesFailed += 1;
						incrementMigrationCounters(migrationId, { failed: 1 });
					},
				},
			});

			markFolderCompleted(migrationId, mapping.sourcePath);
			live.foldersCompleted += 1;
			live.messagesTotal = refreshMigrationMessagesTotal(migrationId);
			syncMigrationCounters(migrationId);
			const afterFolder = getMigrationProgressSnapshot(migrationId, "running", undefined, {
				reconcile: true,
			});
			if (afterFolder) {
				live.messagesCompleted = afterFolder.messagesCompleted;
				live.messagesFailed = afterFolder.messagesFailed;
				live.bytesTransferred = afterFolder.bytesTransferred;
				live.foldersCompleted = afterFolder.foldersCompleted;
				live.messagesTotal = afterFolder.messagesTotal;
				emit(afterFolder);
			}
		}

		const finalStatus: MigrationStatus = ctx.cancelled ? "cancelled" : "completed";
		syncMigrationCounters(migrationId);
		setMigrationStatus(migrationId, finalStatus);
		const finalProgress = getMigrationProgressSnapshot(migrationId, finalStatus, undefined, {
			reconcile: true,
		});
		if (finalProgress) emit(finalProgress);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : "Migration failed";
		if (ctx.cancelled) {
			setMigrationStatus(migrationId, "cancelled");
			throw error;
		}

		syncMigrationCounters(migrationId);
		setMigrationStatus(migrationId, "paused", errMsg);
		const pausedProgress = getMigrationProgressSnapshot(
			migrationId,
			"paused",
			{ error: errMsg },
			{ reconcile: false },
		);
		if (pausedProgress) emit(pausedProgress);
		throw error;
	} finally {
		activeMigrations.delete(migrationId);
		await safeCloseImapClient(sourceClient);
		await safeCloseImapClient(destClient);
	}
}

/** Starts migration in the background; returns as soon as the DB row exists. */
export async function enqueueMigration(
	params: StartMigrationParams,
	emit: ProgressEmitter,
): Promise<string> {
	if (activeMigrations.size >= MAX_CONCURRENT_MIGRATIONS) {
		throw new MigrationCapacityError();
	}
	const migrationId = await prepareMigrationStart(params);
	void executeMigration(migrationId, emit).catch((error) => {
		const msg = error instanceof Error ? error.message : String(error);
		logger.error("migration", `Migration ${migrationId} failed`, msg);
	});
	return migrationId;
}

/** Runs the full migration loop (used by scripts and tests). */
export async function startMigration(
	params: StartMigrationParams,
	emit: ProgressEmitter,
): Promise<string> {
	const migrationId = await prepareMigrationStart(params);
	await executeMigration(migrationId, emit);
	return migrationId;
}

function markMessage(
	db: Database,
	migrationId: string,
	folder: string,
	uid: number,
	status: string,
	sizeBytes: number,
	messageId?: string,
	error?: string,
): void {
	db.prepare(
		`INSERT INTO migration_messages (
      migration_id, source_folder, source_uid, message_id, status, size_bytes, error, transferred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(migration_id, source_folder, source_uid) DO UPDATE SET
      status = excluded.status,
      size_bytes = excluded.size_bytes,
      message_id = excluded.message_id,
      error = excluded.error,
      transferred_at = excluded.transferred_at`,
	).run(migrationId, folder, uid, messageId ?? null, status, sizeBytes, error ?? null);
}

export function getResumableMigrations(): string[] {
	const db = getDatabase();
	const rows = db
		.query(
			`SELECT id FROM migrations WHERE status IN ('failed', 'paused', 'running') ORDER BY updated_at DESC`,
		)
		.all() as Array<{ id: string }>;
	return rows.map((r) => r.id);
}
