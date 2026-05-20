import { randomUUID } from "node:crypto";
import type {
	FolderMapping,
	MailboxCredentials,
	MigrationProgress,
	MigrationStatus,
} from "../../../shared/types";
import { getDatabase } from "../../db/database";
import { encryptString, hashString } from "../crypto/local-secrets";
import { estimateRemainingDuration } from "../../../shared/migration-duration";
import {
	getMigrationById,
	getMigrationProgressSnapshot,
	incrementMigrationCounters,
	markFolderCompleted,
	markMigrationMessage,
	refreshMigrationMessagesTotal,
	seedMigrationFolderTotals,
	setMigrationStatus,
	syncMigrationCounters,
	updateFolderScannedTotal,
} from "../../db/migration-repository";
import {
	createAutopilotState,
	describeCompletionSummary,
	describeFinishingRemainingActivity,
	describeRetryActivity,
	describeScanningActivity,
	describeTransferActivity,
	getTransferConfig,
	recordAutopilotBatchSuccess,
	recordAutopilotRetry,
	type MigrationAutopilotState,
} from "./migration-autopilot";
import { verifyMigrationMailboxes } from "./migration-preflight";
import {
	burnMigrationLaunchTicket,
	type VerifiedLaunchLicense,
} from "../stripe/migration-payment-entitlements";
import {
	countFailedUids,
	describePausedWithRemaining,
	describeStillWorkingActivity,
	hasOnlyPermanentFailures,
	MAX_FAILURE_SWEEPS,
	sweepFailedMessages,
	SWEEP_BASE_DELAY_MS,
} from "./migration-failure-sweeper";
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
import type { MigrationErrorClassification } from "./migration-errors";
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
	autopilot: MigrationAutopilotState;
	plannedSecondsTypical?: number;
}

const activeMigrations = new Map<string, MigrationContext>();
/** Slots reserved from enqueue until executeMigration finishes (capacity limit). */
const activeMigrationSlots = new Set<string>();

export function getActiveMigrationIds(): string[] {
	return Array.from(activeMigrationSlots);
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
	plannedSecondsTypical?: number;
	verifiedLicense?: VerifiedLaunchLicense | null;
};

const pendingPlannedSeconds = new Map<string, number>();

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
		const license = params.verifiedLicense ?? null;

		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, folder_mappings, started_at, updated_at,
        stripe_session_id, license_jti, licensed_total_bytes, license_folder_hash
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?)`,
		).run(
			migrationId,
			sourceRef,
			destRef,
			encryptString(source.email),
			encryptString(destination.email),
			selectedMappings.length,
			encryptString(JSON.stringify(selectedMappings)),
			license?.stripeSessionId ?? null,
			license?.jti ?? null,
			license?.totalBytes ?? null,
			license?.folderPathsHash ?? null,
		);

		if (license) {
			burnMigrationLaunchTicket(license, migrationId);
		}

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
		autopilot: createAutopilotState(),
		plannedSecondsTypical: pendingPlannedSeconds.get(migrationId),
	};
	pendingPlannedSeconds.delete(migrationId);

	activeMigrations.set(migrationId, ctx);

	const db = getDatabase();
	const { source, destination, folderMappings: selectedMappings } = ctx;

	await verifyMigrationMailboxes(source, destination);

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

		emitLiveProgress(emit, migrationId, live, {
			activityPhase: "connecting",
			activityLabel: "Connected — starting your move…",
		});

		const transferHooks = (mapping: FolderMapping) => ({
			shouldStop: () => ctx.cancelled,
			waitWhilePaused: async () => {
				while (ctx.paused) {
					await Bun.sleep(250);
					if (ctx.cancelled) return;
				}
			},
			onMessageCompleted: (_uid: number, sizeBytes: number) => {
				incrementMigrationCounters(migrationId, {
					completed: 1,
					bytes: sizeBytes,
				});
				live.messagesCompleted += 1;
				live.bytesTransferred += sizeBytes;
				const record = getMigrationById(migrationId);
				const startedAt = record?.startedAt;
				const remainingDurationLabel =
					startedAt &&
					estimateRemainingDuration({
						elapsedSeconds: (Date.now() - new Date(startedAt).getTime()) / 1000,
						messagesCompleted: live.messagesCompleted,
						messagesTotal: live.messagesTotal,
						plannedSecondsTypical: ctx.plannedSecondsTypical,
					});
				emitLiveProgress(emit, migrationId, live, {
					currentFolder: mapping.sourcePath,
					activityPhase: "transferring",
					activityLabel: describeTransferActivity(mapping.sourcePath),
					remainingDurationLabel,
				});
			},
			onMessageFailed: () => {
				syncMigrationCounters(migrationId);
				const snap = getMigrationProgressSnapshot(migrationId, "running", undefined, {
					reconcile: true,
				});
				if (snap) {
					live.messagesFailed = snap.messagesFailed;
					live.messagesCompleted = snap.messagesCompleted;
				}
			},
			onRetry: (
				_uid: number,
				classification: MigrationErrorClassification,
				retryAfterMs: number,
			) => {
				recordAutopilotRetry(ctx.autopilot, classification);
				const activityPhase = classification.reconnect
					? "reconnecting"
					: classification.kind === "throttled"
						? "throttled"
						: "retrying";
				emitLiveProgress(emit, migrationId, live, {
					currentFolder: mapping.sourcePath,
					activityPhase,
					activityLabel: describeRetryActivity(classification, retryAfterMs),
					retryAfterMs,
				});
			},
			onBatchFinished: () => {
				recordAutopilotBatchSuccess(ctx.autopilot);
			},
		});

		for (const mapping of selectedMappings) {
			if (ctx.cancelled) break;
			while (ctx.paused) {
				await Bun.sleep(250);
				if (ctx.cancelled) break;
			}

			emitLiveProgress(emit, migrationId, live, {
				currentFolder: mapping.sourcePath,
				activityPhase: "scanning",
				activityLabel: describeScanningActivity(mapping.sourcePath),
			});

			await ensureFolderExists(destClient, mapping.destPath);

			const folderRow = db
				.query(
					`SELECT status FROM migration_folders
           WHERE migration_id = ? AND (source_path_hash = ? OR source_path = ?)`,
				)
				.get(
					migrationId,
					hashString(`migration-folder:${migrationId}`, mapping.sourcePath),
					mapping.sourcePath,
				) as { status: string } | null;

			if (folderRow?.status === "completed") {
				emitLiveProgress(emit, migrationId, live, {
					currentFolder: mapping.sourcePath,
				});
				continue;
			}

			db.prepare(
				`UPDATE migration_folders
         SET status = 'running'
         WHERE migration_id = ? AND (source_path_hash = ? OR source_path = ?)`,
			).run(
				migrationId,
				hashString(`migration-folder:${migrationId}`, mapping.sourcePath),
				mapping.sourcePath,
			);

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
             WHERE migration_id = ?
               AND (source_folder_hash = ? OR source_folder = ?)
               AND source_uid = ?`,
					)
					.get(
						migrationId,
						hashString(`migration-message-folder:${migrationId}`, mapping.sourcePath),
						mapping.sourcePath,
						uid,
					) as { status: string } | null;
				if (!existing) return true;
				return existing.status !== "completed";
			});

			emitLiveProgress(emit, migrationId, live, {
				currentFolder: mapping.sourcePath,
				activityPhase: "transferring",
				activityLabel: describeTransferActivity(mapping.sourcePath),
			});

			await transferFolderWithLanes({
				db,
				migrationId,
				mapping,
				sourceCreds: source,
				destCreds: destination,
				destClient,
				pendingUids,
				transfer: getTransferConfig(ctx.autopilot),
				markMessage: markMigrationMessage,
				hooks: transferHooks(mapping),
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

		if (!ctx.cancelled) {
			ctx.autopilot.laneCount = Math.min(8, ctx.autopilot.laneCount + 1);
			for (let sweep = 0; sweep < MAX_FAILURE_SWEEPS; sweep++) {
				if (ctx.cancelled) break;
				syncMigrationCounters(migrationId);
				const remaining = countFailedUids(migrationId, selectedMappings);
				if (remaining === 0) break;

				emitLiveProgress(emit, migrationId, live, {
					activityPhase: "transferring",
					activityLabel:
						sweep === 0
							? describeFinishingRemainingActivity()
							: describeStillWorkingActivity(remaining),
				});

				await sweepFailedMessages({
					db,
					migrationId,
					mappings: selectedMappings,
					source,
					destination,
					destClient,
					transfer: getTransferConfig(ctx.autopilot),
					markMessage: markMigrationMessage,
					hooksForMapping: (mapping) => transferHooks(mapping),
				});

				syncMigrationCounters(migrationId);
				const reconciled = getMigrationProgressSnapshot(migrationId, "running", undefined, {
					reconcile: true,
				});
				if (reconciled) {
					live.messagesCompleted = reconciled.messagesCompleted;
					live.messagesFailed = reconciled.messagesFailed;
					live.bytesTransferred = reconciled.bytesTransferred;
				}
				if (countFailedUids(migrationId, selectedMappings) === 0) break;
				await Bun.sleep(SWEEP_BASE_DELAY_MS + sweep * 500);
			}
		}

		syncMigrationCounters(migrationId);
		const remainingFailed = countFailedUids(migrationId, selectedMappings);
		live.messagesFailed = remainingFailed;

		let finalStatus: MigrationStatus;
		let completionNote: string | undefined;
		if (ctx.cancelled) {
			finalStatus = "cancelled";
		} else if (remainingFailed > 0) {
			if (hasOnlyPermanentFailures(db, migrationId, selectedMappings)) {
				finalStatus = "paused";
				completionNote = describeCompletionSummary(remainingFailed);
			} else {
				finalStatus = "paused";
				completionNote = describePausedWithRemaining(remainingFailed);
			}
		} else {
			finalStatus = "completed";
			completionNote = undefined;
		}

		setMigrationStatus(migrationId, finalStatus);
		const finalProgress = getMigrationProgressSnapshot(
			migrationId,
			finalStatus,
			completionNote ? { activityLabel: completionNote } : undefined,
			{ reconcile: true },
		);
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
		activeMigrationSlots.delete(migrationId);
		await safeCloseImapClient(sourceClient);
		await safeCloseImapClient(destClient);
	}
}

/** Starts migration in the background; returns as soon as the DB row exists. */
export async function enqueueMigration(
	params: StartMigrationParams,
	emit: ProgressEmitter,
): Promise<string> {
	if (activeMigrationSlots.size >= MAX_CONCURRENT_MIGRATIONS) {
		throw new MigrationCapacityError();
	}
	const migrationId = await prepareMigrationStart(params);
	if (params.plannedSecondsTypical && params.plannedSecondsTypical > 0) {
		pendingPlannedSeconds.set(migrationId, params.plannedSecondsTypical);
	}
	activeMigrationSlots.add(migrationId);
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

export function getResumableMigrations(): string[] {
	const db = getDatabase();
	const rows = db
		.query(
			`SELECT id FROM migrations WHERE status IN ('failed', 'paused', 'running') ORDER BY updated_at DESC`,
		)
		.all() as Array<{ id: string }>;
	return rows.map((r) => r.id);
}
