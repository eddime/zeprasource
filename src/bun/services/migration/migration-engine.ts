import { randomUUID } from "node:crypto";
import type {
	FolderMapping,
	MailboxCredentials,
	MigrationJobType,
	MigrationProgress,
	MigrationStatus,
} from "../../../shared/types";
import { getDatabase } from "../../db/database";
import { encryptString, hashString } from "../crypto/local-secrets";
import { estimateRemainingDuration } from "../../../shared/migration-duration";
import { MIGRATION_COPY } from "../../../shared/migration-copy";
import {
	buildRetryEndsAt,
	clearTransientActivity,
	runningProgressExtras,
	sanitizeMigrationProgress,
} from "../../../shared/migration-progress";
import {
	getMigrationById,
	getMigrationProgressSnapshot,
	incrementMigrationCounters,
	listStagedUidsForFolder,
	markFolderCompleted,
	markMigrationMessage,
	markMissingFolderMessagesFailed,
	refreshMigrationMessagesTotal,
	seedMigrationFolderTotals,
	setMigrationStatus,
	setUserPausedFlag,
	isUserPausedMigration,
	syncMigrationCounters,
	updateFolderScannedTotal,
} from "../../db/migration-repository";
import {
	createAutopilotState,
	describeCompletionSummary,
	describeFinishingRemainingActivity,
	describeRetryActivity,
	describeDeliverActivity,
	describeIngestActivity,
	describeScanningActivity,
	describeTransferActivity,
	getTransferConfig,
	recordAutopilotBatchSuccess,
	recordAutopilotRetry,
	type MigrationAutopilotState,
} from "./migration-autopilot";
import { verifyMigrationMailboxes, verifySourceMailbox } from "./migration-preflight";
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
	localBackupPlaceholderDestination,
	snapshotMigrationMailboxes,
} from "./migration-resume";
import {
	connectImapClient,
	safeCloseImapClient,
	ensureFolderExists,
} from "../imap/imap-client";
import { startImapKeepalive } from "../imap/imap-keepalive";
import { canUseServerSideCopy } from "../imap/imap-same-host";
import { openMailSource } from "../mail/mail-source";
import { ResilientMailSource } from "../mail/resilient-mail-source";
import { transferFolderWithLanes, type FolderTransferPhase } from "./migration-lanes";
import type { MigrationErrorClassification } from "./migration-errors";
import {
	resolveMigrationProviderProfile,
	type MigrationProviderProfile,
} from "./migration-provider-profile";
import { SharedDestAppender } from "./shared-dest-appender";
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

function engineStatus(ctx: MigrationContext): MigrationStatus {
	if (ctx.cancelled) return "cancelled";
	if (ctx.paused) return "paused";
	return "running";
}

function emitLiveProgress(
	emit: ProgressEmitter,
	ctx: MigrationContext,
	state: LiveProgressState,
	extras?: Partial<MigrationProgress>,
): void {
	const userPaused = ctx.paused && isUserPausedMigration(ctx.migrationId);
	const safeExtras = userPaused ? { ...extras, ...clearTransientActivity() } : extras;

	emit(
		sanitizeMigrationProgress({
			migrationId: ctx.migrationId,
			status: engineStatus(ctx),
			userInitiatedPause: userPaused ? true : undefined,
			foldersTotal: state.foldersTotal,
			foldersCompleted: state.foldersCompleted,
			messagesTotal: state.messagesTotal,
			messagesCompleted: state.messagesCompleted,
			messagesFailed: state.messagesFailed,
			bytesTransferred: state.bytesTransferred,
			...safeExtras,
			updatedAt: new Date().toISOString(),
		}),
	);
}

interface MigrationContext {
	migrationId: string;
	jobType: MigrationJobType;
	source: MailboxCredentials;
	destination: MailboxCredentials;
	folderMappings: FolderMapping[];
	backupRootPath: string | null;
	cancelled: boolean;
	paused: boolean;
	autopilot: MigrationAutopilotState;
	profile: MigrationProviderProfile;
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
	setUserPausedFlag(migrationId, true);
	setMigrationStatus(migrationId, "paused");
}

export function unpauseMigration(migrationId: string): void {
	const ctx = activeMigrations.get(migrationId);
	if (ctx) ctx.paused = false;
}

/**
 * Continue a user-paused migration. If the engine task is still in memory, only
 * clears the pause flag. Otherwise starts a new background run (after crash).
 */
export async function resumeMigration(
	migrationId: string,
	emit: ProgressEmitter,
): Promise<void> {
	// Always unpause the in-memory engine when it still exists — never delete the map
	// entry while executeMigration is running (would orphan a live transfer).
	if (activeMigrations.has(migrationId)) {
		unpauseMigration(migrationId);
		setUserPausedFlag(migrationId, false);
		setMigrationStatus(migrationId, "running", null);
		const snapshot = getMigrationProgressSnapshot(
			migrationId,
			"running",
			runningProgressExtras(),
			{ reconcile: true },
		);
		if (snapshot) emit(snapshot);
		return;
	}

	setUserPausedFlag(migrationId, false);
	setMigrationStatus(migrationId, "running", null);
	activeMigrationSlots.delete(migrationId);

	await enqueueMigration({ resumeMigrationId: migrationId }, emit);
}

type StartMigrationParams = {
	source?: MailboxCredentials;
	destination?: MailboxCredentials;
	folderMappings?: FolderMapping[];
	backupRootPath?: string | null;
	jobType?: MigrationJobType;
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
	} else {
		const jobType = params.jobType ?? "migrate";
		if (jobType === "backup") {
			if (!source || !params.backupRootPath?.trim() || selectedMappings.length === 0) {
				throw new Error("Source mailbox, backup folder, and folders are required.");
			}
			destination = localBackupPlaceholderDestination();
		} else if (!source || !destination || selectedMappings.length === 0) {
			throw new Error("Source, destination, and folder mappings are required.");
		}
	}

	if (!params.resumeMigrationId) {
		const sourceRef = `migration/${migrationId}/source`;
		const destRef = `migration/${migrationId}/destination`;
		const license = params.verifiedLicense ?? null;
		const jobType = params.jobType ?? "migrate";

		const backupStored = params.backupRootPath?.trim()
			? encryptString(params.backupRootPath.trim())
			: null;

		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, folder_mappings, started_at, updated_at,
        stripe_session_id, license_jti, licensed_total_bytes, license_folder_hash,
        backup_root_path, job_type
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?)`,
		).run(
			migrationId,
			sourceRef,
			destRef,
			encryptString(source!.email),
			encryptString(destination!.email),
			selectedMappings.length,
			encryptString(JSON.stringify(selectedMappings)),
			license?.stripeSessionId ?? null,
			license?.jti ?? null,
			license?.totalBytes ?? null,
			license?.folderPathsHash ?? null,
			backupStored,
			jobType,
		);

		if (license) {
			burnMigrationLaunchTicket(license, migrationId);
		}

		snapshotMigrationMailboxes(migrationId, source!, destination!);
		seedMigrationFolderTotals(migrationId, selectedMappings);
	} else {
		snapshotMigrationMailboxes(migrationId, source!, destination!);
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

	const db = getDatabase();
	const backupOnly = payload.jobType === "backup";
	const profile = resolveMigrationProviderProfile(
		payload.source,
		payload.destination,
		backupOnly,
	);

	const ctx: MigrationContext = {
		migrationId,
		jobType: payload.jobType,
		source: payload.source,
		destination: payload.destination,
		folderMappings: payload.folderMappings,
		backupRootPath: payload.backupRootPath,
		cancelled: false,
		paused: false,
		autopilot: createAutopilotState(profile),
		profile,
		plannedSecondsTypical: pendingPlannedSeconds.get(migrationId),
	};
	pendingPlannedSeconds.delete(migrationId);

	activeMigrations.set(migrationId, ctx);

	const { source, destination, folderMappings: selectedMappings } = ctx;

	if (backupOnly) {
		await verifySourceMailbox(source);
	} else {
		await verifyMigrationMailboxes(source, destination);
	}

	const destClient = backupOnly ? null : await connectImapClient(destination);
	const sharedDestAppender =
		destClient != null ? new SharedDestAppender(destClient, destination) : null;

	const rawSourceSession = await openMailSource(source);
	const resilientSource = new ResilientMailSource(source, rawSourceSession);
	const useServerSideCopy = canUseServerSideCopy(source, destination, backupOnly);
	const stopSourceKeepalive = startImapKeepalive(
		() =>
			resilientSource.current.protocol === "imap"
				? resilientSource.current.client
				: null,
	);
	const stopDestKeepalive = destClient
		? startImapKeepalive(() => destClient)
		: () => undefined;

	logger.info(
		"migration",
		`Transfer profile ${profile.id} (single source session, batch ${profile.fetchBatchSize}${useServerSideCopy ? ", server COPY" : ""}${backupOnly ? "" : ", rolling pipeline"})`,
		migrationId,
	);

	try {

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
		if (baseline) {
			emit(
				sanitizeMigrationProgress({
					...baseline,
					status: engineStatus(ctx),
					userInitiatedPause:
						ctx.paused && isUserPausedMigration(ctx.migrationId) ? true : undefined,
				}),
			);
		}

		emitLiveProgress(emit, ctx, live, {
			activityPhase: "connecting",
			activityLabel: MIGRATION_COPY.running.connecting,
		});

		let lastRetryClassification: MigrationErrorClassification | null = null;
		let lastRetryUiEmitAt = 0;

		const transferHooks = (mapping: FolderMapping) => ({
			shouldStop: () => ctx.cancelled || ctx.paused,
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
				emitLiveProgress(emit, ctx, live, {
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
					live.messagesTotal = snap.messagesTotal;
				}
				const remaining = countFailedUids(migrationId, selectedMappings);
				emitLiveProgress(emit, ctx, live, {
					currentFolder: mapping.sourcePath,
					activityPhase: "transferring",
					activityLabel:
						remaining > 0
							? describeStillWorkingActivity(remaining)
							: describeTransferActivity(mapping.sourcePath),
				});
			},
			onRetry: (
				_uid: number,
				classification: MigrationErrorClassification,
				retryAfterMs: number,
			) => {
				if (ctx.paused || ctx.cancelled) return;
				lastRetryClassification = classification;
				recordAutopilotRetry(ctx.autopilot, classification);
				const now = Date.now();
				if (now - lastRetryUiEmitAt < 5_000) return;
				lastRetryUiEmitAt = now;
				const activityPhase = classification.reconnect
					? "reconnecting"
					: classification.kind === "throttled"
						? "throttled"
						: "retrying";
				emitLiveProgress(emit, ctx, live, {
					currentFolder: mapping.sourcePath,
					activityPhase,
					activityLabel: describeRetryActivity(classification),
					retryEndsAt: buildRetryEndsAt(retryAfterMs),
				});
			},
			afterRetryWait: () => {
				if (ctx.paused || ctx.cancelled) return;
				lastRetryClassification = null;
				emitLiveProgress(emit, ctx, live, {
					currentFolder: mapping.sourcePath,
					...runningProgressExtras(),
					activityPhase: "transferring",
					activityLabel: describeTransferActivity(mapping.sourcePath),
				});
			},
			onBatchFinished: () => {
				recordAutopilotBatchSuccess(ctx.autopilot);
			},
		});

		const resolvePendingUids = (
			mapping: FolderMapping,
			allUids: number[],
			phase: FolderTransferPhase,
		): number[] => {
			if (phase === "deliver") {
				return listStagedUidsForFolder(migrationId, mapping.sourcePath);
			}
			return allUids.filter((uid) => {
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
				if (existing.status === "failed") return false;
				if (existing.status === "completed" || existing.status === "staged") return false;
				return true;
			});
		};

		const processMappingFolder = async (
			mapping: FolderMapping,
			transferPhase: FolderTransferPhase,
		): Promise<void> => {
			if (ctx.cancelled) return;

			folderPass: while (true) {
				while (ctx.paused) {
					emitLiveProgress(emit, ctx, live, {
						activityLabel: MIGRATION_COPY.userPaused.hint,
					});
					await Bun.sleep(500);
					if (ctx.cancelled) break folderPass;
				}
				if (ctx.paused || ctx.cancelled) break folderPass;

				emitLiveProgress(emit, ctx, live, {
				currentFolder: mapping.sourcePath,
				activityPhase: "scanning",
				activityLabel: describeScanningActivity(mapping.sourcePath),
			});

			if (destClient) {
				await ensureFolderExists(destClient, mapping.destPath);
			}

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
				emitLiveProgress(emit, ctx, live, {
					currentFolder: mapping.sourcePath,
				});
				break folderPass;
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

			const uids =
				transferPhase === "deliver"
					? []
					: await resilientSource.fetchFolderUids(mapping.sourcePath);
			if (transferPhase !== "deliver") {
				live.messagesTotal = updateFolderScannedTotal(
					migrationId,
					mapping.sourcePath,
					uids.length,
				);
			}

			const pendingUids = resolvePendingUids(mapping, uids, transferPhase);
			if (pendingUids.length === 0) {
				if (transferPhase === "deliver") {
					const folderUidsForAudit = await resilientSource.fetchFolderUids(mapping.sourcePath);
					markMissingFolderMessagesFailed(
						migrationId,
						mapping.sourcePath,
						folderUidsForAudit,
					);
					markFolderCompleted(migrationId, mapping.sourcePath);
					live.foldersCompleted += 1;
				}
				break folderPass;
			}

			const activityPhase =
				transferPhase === "ingest"
					? "ingesting"
					: transferPhase === "deliver"
						? "delivering"
						: "transferring";
			const activityLabel =
				transferPhase === "ingest"
					? describeIngestActivity(mapping.sourcePath)
					: transferPhase === "deliver"
						? describeDeliverActivity(mapping.sourcePath)
						: describeTransferActivity(mapping.sourcePath);

			emitLiveProgress(emit, ctx, live, {
				currentFolder: mapping.sourcePath,
				activityPhase,
				activityLabel,
			});

			await transferFolderWithLanes({
				db,
				migrationId,
				mapping,
				resilientSource,
				sharedDest: sharedDestAppender,
				pendingUids,
				transfer: getTransferConfig(ctx.autopilot),
				backupRootPath: ctx.backupRootPath,
				backupOnly,
				useServerSideCopy,
				transferPhase,
				markMessage: markMigrationMessage,
				hooks: transferHooks(mapping),
			});

			syncMigrationCounters(migrationId);
			const midFolder = getMigrationProgressSnapshot(migrationId, "running", undefined, {
				reconcile: true,
			});
			if (midFolder) {
				live.messagesCompleted = midFolder.messagesCompleted;
				live.messagesFailed = midFolder.messagesFailed;
				live.messagesTotal = midFolder.messagesTotal;
				emitLiveProgress(emit, ctx, live, {
					currentFolder: mapping.sourcePath,
					activityPhase,
					activityLabel,
				});
			}

			if (ctx.paused) {
				emitLiveProgress(emit, ctx, live, {
					currentFolder: mapping.sourcePath,
					activityLabel: MIGRATION_COPY.userPaused.hint,
				});
				continue folderPass;
			}
			if (ctx.cancelled) break folderPass;

			if (transferPhase === "ingest") {
				break folderPass;
			}

			const folderUidsForAudit =
				uids.length > 0
					? uids
					: await resilientSource.fetchFolderUids(mapping.sourcePath);
			markMissingFolderMessagesFailed(migrationId, mapping.sourcePath, folderUidsForAudit);

			markFolderCompleted(migrationId, mapping.sourcePath);
			live.foldersCompleted += 1;
			live.messagesTotal = refreshMigrationMessagesTotal(migrationId);
			syncMigrationCounters(migrationId);
			const afterFolder = getMigrationProgressSnapshot(
				migrationId,
				engineStatus(ctx),
				undefined,
				{ reconcile: true },
			);
			if (afterFolder) {
				live.messagesCompleted = afterFolder.messagesCompleted;
				live.messagesFailed = afterFolder.messagesFailed;
				live.bytesTransferred = afterFolder.bytesTransferred;
				live.foldersCompleted = afterFolder.foldersCompleted;
				live.messagesTotal = afterFolder.messagesTotal;
				emit(
					sanitizeMigrationProgress({
						...afterFolder,
						status: engineStatus(ctx),
						userInitiatedPause:
							ctx.paused && isUserPausedMigration(ctx.migrationId) ? true : undefined,
					}),
				);
			}
				break folderPass;
			}
		};

		const useRollingPipeline = !backupOnly && !useServerSideCopy;

		if (useRollingPipeline) {
			let deliverChain = Promise.resolve();
			for (const mapping of selectedMappings) {
				if (ctx.cancelled) break;
				emitLiveProgress(emit, ctx, live, {
					activityPhase: "ingesting",
					activityLabel: describeIngestActivity(mapping.sourcePath),
					currentFolder: mapping.sourcePath,
				});
				await processMappingFolder(mapping, "ingest");
				if (ctx.cancelled) break;
				const deliverMapping = mapping;
				deliverChain = deliverChain.then(async () => {
					if (ctx.cancelled) return;
					emitLiveProgress(emit, ctx, live, {
						activityPhase: "delivering",
						activityLabel: describeDeliverActivity(deliverMapping.sourcePath),
						currentFolder: deliverMapping.sourcePath,
					});
					await processMappingFolder(deliverMapping, "deliver");
				});
			}
			await deliverChain;
		} else {
			const folderPhases: FolderTransferPhase[] = ["combined"];
			for (const phase of folderPhases) {
				if (ctx.cancelled) break;
				for (const mapping of selectedMappings) {
					if (ctx.cancelled) break;
					await processMappingFolder(mapping, phase);
				}
			}
		}

		while (ctx.paused && !ctx.cancelled) {
			emitLiveProgress(emit, ctx, live, {
				activityLabel: MIGRATION_COPY.userPaused.hint,
			});
			await Bun.sleep(500);
		}

		if (!ctx.cancelled && !ctx.paused) {
			for (let sweep = 0; sweep < MAX_FAILURE_SWEEPS; sweep++) {
				if (ctx.cancelled || ctx.paused) break;
				syncMigrationCounters(migrationId);
				const remaining = countFailedUids(migrationId, selectedMappings);
				if (remaining === 0) break;

				emitLiveProgress(emit, ctx, live, {
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
					resilientSource,
					sharedDest: sharedDestAppender,
					useServerSideCopy,
					transfer: getTransferConfig(ctx.autopilot),
					backupRootPath: ctx.backupRootPath,
					backupOnly,
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

		while (ctx.paused && !ctx.cancelled) {
			emitLiveProgress(emit, ctx, live, {
				activityLabel: MIGRATION_COPY.userPaused.hint,
			});
			await Bun.sleep(500);
		}

		syncMigrationCounters(migrationId);
		const finalSnap = getMigrationProgressSnapshot(migrationId, "running", undefined, {
			reconcile: true,
		});
		if (finalSnap) {
			live.messagesCompleted = finalSnap.messagesCompleted;
			live.messagesFailed = finalSnap.messagesFailed;
			live.messagesTotal = finalSnap.messagesTotal;
		}
		const remainingFailed = countFailedUids(migrationId, selectedMappings);
		live.messagesFailed = remainingFailed;

		let finalStatus: MigrationStatus;
		let completionNote: string | undefined;
		if (ctx.cancelled) {
			finalStatus = "cancelled";
		} else if (remainingFailed > 0) {
			setUserPausedFlag(migrationId, false);
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
		setUserPausedFlag(migrationId, false);
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
		stopSourceKeepalive();
		stopDestKeepalive();
		await resilientSource.close();
		if (destClient) await safeCloseImapClient(destClient);
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
		const failed = getMigrationProgressSnapshot(
			migrationId,
			"failed",
			{ error: msg },
			{ reconcile: false },
		);
		if (failed) emit(failed);
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
