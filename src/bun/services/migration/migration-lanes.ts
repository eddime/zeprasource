import type { Database } from "bun:sqlite";
import type { FolderMapping, MailboxCredentials } from "../../../shared/types";
import type { MigrationTransferConfig } from "./migration-autopilot";
import { logger } from "../../utils/logger";
import {
	buildDestinationMessageIdIndex,
	normalizeMessageId,
} from "../imap/destination-message-index";
import {
	appendMessage,
	createImapClient,
	fetchMessagesBatch,
	flagsToArray,
	safeCloseImapClient,
	type FetchedMigrationMessage,
} from "../imap/imap-client";
import {
	INTER_BATCH_PAUSE_MS,
	MESSAGE_TRANSFER_TIMEOUT_MS,
	MIGRATION_FETCH_BATCH_SIZE,
	MIGRATION_RETRY_DELAY_DEFAULTS,
} from "./migration-constants";
import {
	classifyMigrationError,
	type MigrationErrorClassification,
} from "./migration-errors";
import { computeRetryDelay } from "./retry-policy";
import { writeBackupMessage } from "../backup/backup-writer";

export function shardUids(uids: number[], laneCount: number): number[][] {
	if (uids.length === 0) return [];
	const lanes = Math.max(1, Math.min(laneCount, uids.length));
	const shards: number[][] = Array.from({ length: lanes }, () => []);
	for (let i = 0; i < uids.length; i++) {
		shards[i % lanes]!.push(uids[i]!);
	}
	return shards.filter((shard) => shard.length > 0);
}

function createAsyncMutex() {
	let chain = Promise.resolve();
	return {
		run<T>(fn: () => Promise<T>): Promise<T> {
			const next = chain.then(fn, fn);
			chain = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		},
	};
}

export type FolderTransferHooks = {
	shouldStop: () => boolean;
	waitWhilePaused: () => Promise<void>;
	onMessageCompleted: (uid: number, sizeBytes: number) => void;
	onMessageFailed: (uid: number) => void;
	onRetry?: (
		uid: number,
		classification: MigrationErrorClassification,
		retryAfterMs: number,
	) => void;
	/** Called when a retry backoff sleep finishes and a new attempt is about to start. */
	afterRetryWait?: () => void;
	onBatchFinished?: () => void;
};

type MarkMessageFn = (
	db: Database,
	migrationId: string,
	folder: string,
	uid: number,
	status: string,
	sizeBytes: number,
	messageId?: string,
	error?: string,
	retryCount?: number,
) => void;

async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
					ms,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function transferMessage(
	db: Database,
	migrationId: string,
	mapping: FolderMapping,
	msg: FetchedMigrationMessage,
	transfer: MigrationTransferConfig,
	destClient: Awaited<ReturnType<typeof createImapClient>>,
	destMessageIds: Set<string>,
	duplicateLock: ReturnType<typeof createAsyncMutex>,
	backupAccountDir: string | null,
	markMessage: MarkMessageFn,
	hooks: FolderTransferHooks,
): Promise<void> {
	const { uid, source, flags, internalDate, messageId } = msg;

	let reservedMessageIdKey: string | undefined;
	if (transfer.skipDuplicates && messageId) {
		const key = normalizeMessageId(messageId);
		const skip = await duplicateLock.run(async () => {
			if (destMessageIds.has(key)) return true;
			destMessageIds.add(key);
			return false;
		});
		if (skip) {
			markMessage(db, migrationId, mapping.sourcePath, uid, "completed", 0, messageId);
			hooks.onMessageCompleted(uid, 0);
			return;
		}
		reservedMessageIdKey = key;
	}

	const flagList = transfer.preserveFlags ? flagsToArray(flags) : undefined;
	try {
		await withTimeout(
			appendMessage(destClient, mapping.destPath, source, {
				flags: flagList,
				internalDate,
			}),
			MESSAGE_TRANSFER_TIMEOUT_MS,
			`Append to ${mapping.destPath}`,
		);
	} catch (error) {
		if (reservedMessageIdKey) {
			await duplicateLock.run(async () => {
				destMessageIds.delete(reservedMessageIdKey!);
			});
		}
		throw error;
	}

	if (backupAccountDir) {
		const backupResult = await writeBackupMessage({
			accountDir: backupAccountDir,
			folderPath: mapping.sourcePath,
			uid,
			source,
		});
		if (backupResult.status === "failed") {
			logger.warn(
				"backup",
				`Backup write failed for ${mapping.sourcePath} uid ${uid}`,
				backupResult.error,
			);
		}
	}

	const size = source.byteLength;
	markMessage(db, migrationId, mapping.sourcePath, uid, "completed", size, messageId);
	hooks.onMessageCompleted(uid, size);
}

async function runMigrationLane(options: {
	db: Database;
	migrationId: string;
	mapping: FolderMapping;
	sourceCreds: MailboxCredentials;
	destCreds: MailboxCredentials;
	uids: number[];
	transfer: MigrationTransferConfig;
	destMessageIds: Set<string>;
	duplicateLock: ReturnType<typeof createAsyncMutex>;
	backupAccountDir: string | null;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	const {
		db,
		migrationId,
		mapping,
		sourceCreds,
		destCreds,
		uids,
		transfer,
		destMessageIds,
		duplicateLock,
		backupAccountDir,
		markMessage,
		hooks,
	} = options;

	const sourceClient = await createImapClient(sourceCreds);
	const destClient = await createImapClient(destCreds);
	try {
		await sourceClient.connect();
		await destClient.connect();

		let prefetchedBatch: Promise<FetchedMigrationMessage[]> | undefined;
		for (let i = 0; i < uids.length; i += MIGRATION_FETCH_BATCH_SIZE) {
			if (hooks.shouldStop()) return;
			await hooks.waitWhilePaused();
			if (hooks.shouldStop()) return;

			const batchUids = uids.slice(i, i + MIGRATION_FETCH_BATCH_SIZE);
			const nextBatchUids = uids.slice(
				i + MIGRATION_FETCH_BATCH_SIZE,
				i + 2 * MIGRATION_FETCH_BATCH_SIZE,
			);
			const currentFetch =
				prefetchedBatch ?? fetchMessagesBatch(sourceClient, mapping.sourcePath, batchUids);
			prefetchedBatch =
				nextBatchUids.length > 0
					? fetchMessagesBatch(sourceClient, mapping.sourcePath, nextBatchUids)
					: undefined;

			let messages: FetchedMigrationMessage[];
			try {
				messages = await currentFetch;
			} catch {
				prefetchedBatch = undefined;
				for (const uid of batchUids) {
					await processUidWithRetries({
						db,
						migrationId,
						mapping,
						uid,
						sourceClient,
						destClient,
						transfer,
						destMessageIds,
						duplicateLock,
						backupAccountDir,
						markMessage,
						hooks,
					});
				}
				continue;
			}

			const byUid = new Map(messages.map((m) => [m.uid, m]));
			for (const uid of batchUids) {
				if (hooks.shouldStop()) return;
				await hooks.waitWhilePaused();
				if (hooks.shouldStop()) return;

				const msg = byUid.get(uid);
				if (!msg) {
					await processUidWithRetries({
						db,
						migrationId,
						mapping,
						uid,
						sourceClient,
						destClient,
						transfer,
						destMessageIds,
						duplicateLock,
						backupAccountDir,
						markMessage,
						hooks,
					});
					continue;
				}

				await processFetchedWithRetries({
					db,
					migrationId,
					mapping,
					msg,
					destClient,
					transfer,
					destMessageIds,
					duplicateLock,
					backupAccountDir,
					markMessage,
					hooks,
				});
			}
			hooks.onBatchFinished?.();
			if (INTER_BATCH_PAUSE_MS > 0) {
				await Bun.sleep(INTER_BATCH_PAUSE_MS);
			}
		}
	} finally {
		await safeCloseImapClient(sourceClient);
		await safeCloseImapClient(destClient);
	}
}

async function sleepRespectingHooks(ms: number, hooks: FolderTransferHooks): Promise<void> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (hooks.shouldStop()) return;
		await hooks.waitWhilePaused();
		if (hooks.shouldStop()) return;
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await Bun.sleep(Math.min(250, remaining));
	}
}

async function processFetchedWithRetries(options: {
	db: Database;
	migrationId: string;
	mapping: FolderMapping;
	msg: FetchedMigrationMessage;
	destClient: Awaited<ReturnType<typeof createImapClient>>;
	transfer: MigrationTransferConfig;
	destMessageIds: Set<string>;
	duplicateLock: ReturnType<typeof createAsyncMutex>;
	backupAccountDir: string | null;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	const { msg, transfer, hooks, markMessage, db, migrationId, mapping } = options;
	let attempt = 0;
	while (attempt < transfer.maxRetryAttempts) {
		if (hooks.shouldStop()) return;
		await hooks.waitWhilePaused();
		if (hooks.shouldStop()) return;

		try {
			await transferMessage(
				db,
				migrationId,
				mapping,
				msg,
				transfer,
				options.destClient,
				options.destMessageIds,
				options.duplicateLock,
				options.backupAccountDir,
				markMessage,
				hooks,
			);
			return;
		} catch (error) {
			attempt += 1;
			const classification = classifyMigrationError(error);
			if (!classification.retryable || attempt >= transfer.maxRetryAttempts) {
				hooks.onMessageFailed(msg.uid);
				const errMsg = classification.userMessage;
				markMessage(
					db,
					migrationId,
					mapping.sourcePath,
					msg.uid,
					"failed",
					0,
					msg.messageId,
					errMsg,
					attempt,
				);
				logger.error("migration", `Failed UID ${msg.uid} in ${mapping.sourcePath}`, errMsg);
			} else {
				const retryAfterMs = computeRetryDelay(attempt, MIGRATION_RETRY_DELAY_DEFAULTS);
				hooks.onRetry?.(msg.uid, classification, retryAfterMs);
				await sleepRespectingHooks(retryAfterMs, hooks);
				if (hooks.shouldStop()) return;
				hooks.afterRetryWait?.();
			}
		}
	}

	hooks.onMessageFailed(msg.uid);
	markMessage(
		db,
		migrationId,
		mapping.sourcePath,
		msg.uid,
		"failed",
		0,
		msg.messageId,
		"Could not move this message after several tries",
		transfer.maxRetryAttempts,
	);
	logger.error(
		"migration",
		`Gave up UID ${msg.uid} in ${mapping.sourcePath} after ${transfer.maxRetryAttempts} attempts`,
	);
}

async function processUidWithRetries(options: {
	db: Database;
	migrationId: string;
	mapping: FolderMapping;
	uid: number;
	sourceClient: Awaited<ReturnType<typeof createImapClient>>;
	destClient: Awaited<ReturnType<typeof createImapClient>>;
	transfer: MigrationTransferConfig;
	destMessageIds: Set<string>;
	duplicateLock: ReturnType<typeof createAsyncMutex>;
	backupAccountDir: string | null;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	let msg: FetchedMigrationMessage | undefined;
	for (let fetchAttempt = 0; fetchAttempt < 12; fetchAttempt++) {
		if (options.hooks.shouldStop()) return;
		await options.hooks.waitWhilePaused();
		if (options.hooks.shouldStop()) return;

		const batch = await fetchMessagesBatch(
			options.sourceClient,
			options.mapping.sourcePath,
			[options.uid],
		);
		msg = batch[0];
		if (msg) break;
		await sleepRespectingHooks(400 + fetchAttempt * 200, options.hooks);
		if (options.hooks.shouldStop()) return;
	}
	if (!msg) {
		options.hooks.onMessageFailed(options.uid);
		options.markMessage(
			options.db,
			options.migrationId,
			options.mapping.sourcePath,
			options.uid,
			"failed",
			0,
			undefined,
			`Message UID ${options.uid} could not be read — will retry`,
		);
		return;
	}
	await processFetchedWithRetries({
		db: options.db,
		migrationId: options.migrationId,
		mapping: options.mapping,
		msg,
		destClient: options.destClient,
		transfer: options.transfer,
		destMessageIds: options.destMessageIds,
		duplicateLock: options.duplicateLock,
		backupAccountDir: options.backupAccountDir,
		markMessage: options.markMessage,
		hooks: options.hooks,
	});
}

export async function transferFolderWithLanes(options: {
	db: Database;
	migrationId: string;
	mapping: FolderMapping;
	sourceCreds: MailboxCredentials;
	destCreds: MailboxCredentials;
	destClient: Awaited<ReturnType<typeof createImapClient>>;
	pendingUids: number[];
	transfer: MigrationTransferConfig;
	backupRootPath: string | null;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	const {
		db,
		migrationId,
		mapping,
		sourceCreds,
		destCreds,
		destClient,
		pendingUids,
		transfer,
		backupRootPath: backupAccountDir,
		markMessage,
		hooks,
	} = options;

	if (pendingUids.length === 0) return;

	const destMessageIds = transfer.skipDuplicates
		? await buildDestinationMessageIdIndex(destClient, mapping.destPath)
		: new Set<string>();
	const duplicateLock = createAsyncMutex();
	const shards = shardUids(pendingUids, transfer.parallelConnections);

	await Promise.all(
		shards.map((uids) =>
			runMigrationLane({
				db,
				migrationId,
				mapping,
				sourceCreds,
				destCreds,
				uids,
				transfer,
				destMessageIds,
				duplicateLock,
				backupAccountDir,
				markMessage,
				hooks,
			}),
		),
	);
}
