import type { Database } from "bun:sqlite";
import type { FolderMapping } from "../../../shared/types";
import type { MigrationTransferConfig } from "./migration-autopilot";
import { logger } from "../../utils/logger";
import { copyMessagesUidBatch } from "../imap/imap-copy-batch";
import { resolveDestinationDuplicateIds } from "../imap/destination-dedup-cache";
import type { FetchedEnvelope, FetchedMigrationMessage } from "../imap/imap-client";
import {
	buildUidBatchesByByteBudget,
	buildUidBatchesByCount,
} from "./migration-fetch-batches";
import { normalizeMessageId } from "../imap/destination-message-index";
import { toAppendPayload } from "../imap/imap-append-batch";
import type { ResilientMailSource } from "../mail/resilient-mail-source";
import { TransferBatchQueue } from "./transfer-batch-queue";
import {
	classifyMigrationError,
	type MigrationErrorClassification,
} from "./migration-errors";
import { computeRetryDelay } from "./retry-policy";
import {
	listStagedUidsForFolder,
	listStagedUidsForFolderBySize,
} from "../../db/migration-repository";
import { writeBackupMessage } from "../backup/backup-writer";
import { migrationStagingRoot } from "./migration-staging-path";
import { MigrationStagingStore } from "./migration-staging-store";
import { SharedDestAppender } from "./shared-dest-appender";

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
	contentSha256?: string | null,
) => void;

export type FolderTransferPhase = "combined" | "ingest" | "deliver";

function stagedUidsForDeliver(ctx: TransferContext, fallback: number[]): number[] {
	const sorted = listStagedUidsForFolderBySize(ctx.migrationId, ctx.mapping.sourcePath);
	if (sorted.length > 0) {
		return sorted.map((r) => r.uid);
	}
	return fallback;
}

type TransferContext = {
	db: Database;
	migrationId: string;
	mapping: FolderMapping;
	transfer: MigrationTransferConfig;
	destMessageIds: Set<string>;
	duplicateLock: ReturnType<typeof createAsyncMutex>;
	backupAccountDir: string | null;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
	backupOnly: boolean;
	sharedDest: SharedDestAppender | null;
	staging: MigrationStagingStore | null;
	resilientSource: ResilientMailSource;
	useServerSideCopy: boolean;
	transferPhase: FolderTransferPhase;
};

type PreparedMessage = {
	msg: FetchedMigrationMessage;
	reservedMessageIdKey?: string;
};

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

async function prepareMessage(
	ctx: TransferContext,
	msg: FetchedMigrationMessage,
): Promise<PreparedMessage | "skip" | null> {
	if (ctx.backupOnly) return { msg };

	if (!ctx.transfer.skipDuplicates || !msg.messageId) {
		return { msg };
	}

	const key = normalizeMessageId(msg.messageId);
	const skip = await ctx.duplicateLock.run(async () => {
		if (ctx.destMessageIds.has(key)) return true;
		ctx.destMessageIds.add(key);
		return false;
	});
	if (skip) {
		if (ctx.staging) {
			await ctx.staging.remove(ctx.mapping.sourcePath, msg.uid);
		}
		ctx.markMessage(
			ctx.db,
			ctx.migrationId,
			ctx.mapping.sourcePath,
			msg.uid,
			"completed",
			0,
			msg.messageId,
		);
		ctx.hooks.onMessageCompleted(msg.uid, 0);
		return "skip";
	}
	return { msg, reservedMessageIdKey: key };
}

type FolderFetchPlan = {
	batches: number[][];
	envelopes: Map<number, FetchedEnvelope>;
};

async function planFolderFetch(ctx: TransferContext, uids: number[]): Promise<FolderFetchPlan> {
	const maxBytes = ctx.transfer.fetchByteBudgetBytes;
	const maxCount = ctx.transfer.fetchBatchSize;
	if (ctx.resilientSource.current.protocol !== "imap") {
		return {
			batches: buildUidBatchesByCount(uids, maxCount),
			envelopes: new Map(),
		};
	}
	const envelopes = new Map<number, FetchedEnvelope>();
	const envelopeChunk = Math.max(ctx.transfer.fetchBatchSize * 4, 120);
	for (let i = 0; i < uids.length; i += envelopeChunk) {
		const chunk = uids.slice(i, i + envelopeChunk);
		const meta = await ctx.resilientSource.fetchEnvelopeBatch(ctx.mapping.sourcePath, chunk);
		for (const row of meta) {
			envelopes.set(row.uid, row);
		}
	}
	const ordered = uids.map((uid) => envelopes.get(uid) ?? { uid, sizeBytes: undefined });
	return {
		batches: buildUidBatchesByByteBudget(ordered, maxBytes, maxCount),
		envelopes,
	};
}

async function skipDuplicateFromEnvelope(
	ctx: TransferContext,
	env: FetchedEnvelope,
): Promise<boolean> {
	if (ctx.backupOnly || !ctx.transfer.skipDuplicates || !env.messageId) {
		return false;
	}
	const key = normalizeMessageId(env.messageId);
	const skip = await ctx.duplicateLock.run(async () => {
		if (ctx.destMessageIds.has(key)) return true;
		ctx.destMessageIds.add(key);
		return false;
	});
	if (!skip) return false;
	if (ctx.staging) {
		await ctx.staging.remove(ctx.mapping.sourcePath, env.uid);
	}
	ctx.markMessage(
		ctx.db,
		ctx.migrationId,
		ctx.mapping.sourcePath,
		env.uid,
		"completed",
		0,
		env.messageId,
	);
	ctx.hooks.onMessageCompleted(env.uid, 0);
	return true;
}

async function uidsNeedingBodyFetch(
	ctx: TransferContext,
	batchUids: number[],
	envelopes: Map<number, FetchedEnvelope>,
): Promise<number[]> {
	const need: number[] = [];
	for (const uid of batchUids) {
		const env = envelopes.get(uid) ?? { uid };
		if (await skipDuplicateFromEnvelope(ctx, env)) continue;
		need.push(uid);
	}
	return need;
}

async function releaseDuplicateReservation(
	ctx: TransferContext,
	key: string | undefined,
): Promise<void> {
	if (!key) return;
	await ctx.duplicateLock.run(async () => {
		ctx.destMessageIds.delete(key);
	});
}

async function finalizeMessage(
	ctx: TransferContext,
	msg: FetchedMigrationMessage,
): Promise<void> {
	if (ctx.backupAccountDir) {
		const backupResult = await writeBackupMessage({
			accountDir: ctx.backupAccountDir,
			folderPath: ctx.mapping.sourcePath,
			uid: msg.uid,
			source: msg.source,
		});
		if (backupResult.status === "failed") {
			logger.warn(
				"backup",
				`Backup write failed for ${ctx.mapping.sourcePath} uid ${msg.uid}`,
				backupResult.error,
			);
		}
	}

	const size = msg.source.byteLength;
	ctx.markMessage(
		ctx.db,
		ctx.migrationId,
		ctx.mapping.sourcePath,
		msg.uid,
		"completed",
		size,
		msg.messageId,
		undefined,
		0,
		null,
	);
	if (ctx.staging) {
		await ctx.staging.remove(ctx.mapping.sourcePath, msg.uid);
	}
	ctx.hooks.onMessageCompleted(msg.uid, size);
}

async function persistToStaging(
	ctx: TransferContext,
	msg: FetchedMigrationMessage,
): Promise<void> {
	if (!ctx.staging) return;
	const meta = await ctx.staging.write(ctx.mapping.sourcePath, msg);
	ctx.markMessage(
		ctx.db,
		ctx.migrationId,
		ctx.mapping.sourcePath,
		msg.uid,
		"staged",
		meta.sizeBytes,
		msg.messageId,
		undefined,
		0,
		meta.sha256,
	);
}

async function transferBackupOnly(ctx: TransferContext, msg: FetchedMigrationMessage): Promise<void> {
	if (!ctx.backupAccountDir) {
		throw new Error("Backup folder is not configured.");
	}
	const backupResult = await writeBackupMessage({
		accountDir: ctx.backupAccountDir,
		folderPath: ctx.mapping.sourcePath,
		uid: msg.uid,
		source: msg.source,
	});
	if (backupResult.status === "failed") {
		throw new Error(backupResult.error);
	}
	await finalizeMessage(ctx, msg);
}

async function commitPreparedBatch(
	ctx: TransferContext,
	prepared: PreparedMessage[],
): Promise<void> {
	if (prepared.length === 0) return;

	if (ctx.backupOnly) {
		for (const item of prepared) {
			await transferBackupOnly(ctx, item.msg);
		}
		return;
	}

	const payloads = prepared.map((item) =>
		toAppendPayload(item.msg, ctx.transfer.preserveFlags),
	);

	try {
		await ctx.sharedDest!.appendBatch(ctx.mapping.destPath, payloads);
	} catch (error) {
		for (const item of prepared) {
			await releaseDuplicateReservation(ctx, item.reservedMessageIdKey);
		}
		throw error;
	}

	for (const item of prepared) {
		await finalizeMessage(ctx, item.msg);
	}
}

function markMessageFailed(
	ctx: TransferContext,
	msg: FetchedMigrationMessage,
	errMsg: string,
	attempt: number,
): void {
	ctx.hooks.onMessageFailed(msg.uid);
	ctx.markMessage(
		ctx.db,
		ctx.migrationId,
		ctx.mapping.sourcePath,
		msg.uid,
		"failed",
		0,
		msg.messageId,
		errMsg,
		attempt,
	);
	logger.error("migration", `Failed UID ${msg.uid} in ${ctx.mapping.sourcePath}`, errMsg);
}

async function transferSingleWithRetries(
	ctx: TransferContext,
	msg: FetchedMigrationMessage,
): Promise<void> {
	let attempt = 0;
	while (attempt < ctx.transfer.maxRetryAttempts) {
		if (ctx.hooks.shouldStop()) return;
		await ctx.hooks.waitWhilePaused();
		if (ctx.hooks.shouldStop()) return;

		const prepared = await prepareMessage(ctx, msg);
		if (prepared === "skip" || prepared === null) return;

		try {
			if (ctx.backupOnly) {
				await transferBackupOnly(ctx, prepared.msg);
			} else {
				await ctx.sharedDest!.appendBatch(ctx.mapping.destPath, [
					toAppendPayload(prepared.msg, ctx.transfer.preserveFlags),
				]);
				await finalizeMessage(ctx, prepared.msg);
			}
			return;
		} catch (error) {
			await releaseDuplicateReservation(ctx, prepared.reservedMessageIdKey);
			attempt += 1;
			const classification = classifyMigrationError(error);
			if (!classification.retryable || attempt >= ctx.transfer.maxRetryAttempts) {
				markMessageFailed(ctx, msg, classification.userMessage, attempt);
				return;
			}
			const retryAfterMs = computeRetryDelay(attempt, ctx.transfer.retryDelayDefaults);
			ctx.hooks.onRetry?.(msg.uid, classification, retryAfterMs);
			await sleepRespectingHooks(retryAfterMs, ctx.hooks);
			if (ctx.hooks.shouldStop()) return;
			ctx.hooks.afterRetryWait?.();
		}
	}

	markMessageFailed(
		ctx,
		msg,
		"Could not move this message after several tries",
		ctx.transfer.maxRetryAttempts,
	);
}

async function transferBatchWithRetries(
	ctx: TransferContext,
	messages: FetchedMigrationMessage[],
): Promise<void> {
	if (messages.length === 0) return;

	let attempt = 0;
	while (attempt < ctx.transfer.maxRetryAttempts) {
		if (ctx.hooks.shouldStop()) return;
		await ctx.hooks.waitWhilePaused();
		if (ctx.hooks.shouldStop()) return;

		const prepared: PreparedMessage[] = [];
		for (const msg of messages) {
			const item = await prepareMessage(ctx, msg);
			if (item === "skip" || item === null) continue;
			prepared.push(item);
		}

		if (prepared.length === 0) return;

		try {
			await commitPreparedBatch(ctx, prepared);
			return;
		} catch (error) {
			for (const item of prepared) {
				await releaseDuplicateReservation(ctx, item.reservedMessageIdKey);
			}
			attempt += 1;
			const classification = classifyMigrationError(error);
			if (!classification.retryable || attempt >= ctx.transfer.maxRetryAttempts) {
				for (const item of prepared) {
					markMessageFailed(ctx, item.msg, classification.userMessage, attempt);
				}
				return;
			}
			const retryAfterMs = computeRetryDelay(attempt, ctx.transfer.retryDelayDefaults);
			for (const item of prepared) {
				ctx.hooks.onRetry?.(item.msg.uid, classification, retryAfterMs);
			}
			await sleepRespectingHooks(retryAfterMs, ctx.hooks);
			if (ctx.hooks.shouldStop()) return;
			ctx.hooks.afterRetryWait?.();
		}
	}

	for (const msg of messages) {
		await transferSingleWithRetries(ctx, msg);
	}
}

async function runUploadWorker(
	ctx: TransferContext,
	staging: MigrationStagingStore,
	queue: TransferBatchQueue<number[]>,
): Promise<void> {
	while (true) {
		const uidBatch = await queue.take();
		if (!uidBatch) break;
		if (ctx.hooks.shouldStop()) continue;

		const messages: FetchedMigrationMessage[] = [];
		const reads = await Promise.all(
			uidBatch.map(async (uid) => {
				try {
					const msg = await staging.read(ctx.mapping.sourcePath, uid);
					return { uid, msg, error: null as string | null };
				} catch (error) {
					return {
						uid,
						msg: null,
						error: error instanceof Error ? error.message : "Staged file corrupt — will retry",
					};
				}
			}),
		);
		for (const row of reads) {
			if (row.msg) {
				messages.push(row.msg);
				continue;
			}
			ctx.hooks.onMessageFailed(row.uid);
			ctx.markMessage(
				ctx.db,
				ctx.migrationId,
				ctx.mapping.sourcePath,
				row.uid,
				"failed",
				0,
				undefined,
				row.error ?? "Staged file missing — will retry",
			);
		}
		if (messages.length > 0) {
			await transferBatchWithRetries(ctx, messages);
		}
		ctx.hooks.onBatchFinished?.();
	}
}

async function runStageLane(options: {
	ctx: TransferContext;
	uids: number[];
	uploadQueue: TransferBatchQueue<number[]>;
}): Promise<void> {
	const { ctx, uids, uploadQueue } = options;
	const { resilientSource } = ctx;
	const { batches, envelopes } = await planFolderFetch(ctx, uids);
	let prefetchedBatch: Promise<FetchedMigrationMessage[]> | undefined;

	for (let b = 0; b < batches.length; b++) {
		if (ctx.hooks.shouldStop()) return;
		await ctx.hooks.waitWhilePaused();
		if (ctx.hooks.shouldStop()) return;

		const batchUids = batches[b]!;
		const needBody = await uidsNeedingBodyFetch(ctx, batchUids, envelopes);
		if (needBody.length === 0) {
			if (ctx.transfer.interBatchPauseMs > 0) {
				await Bun.sleep(ctx.transfer.interBatchPauseMs);
			}
			continue;
		}

		const nextBatch = batches[b + 1];
		if (!prefetchedBatch && nextBatch) {
			const nextNeed = await uidsNeedingBodyFetch(ctx, nextBatch, envelopes);
			if (nextNeed.length > 0) {
				prefetchedBatch = resilientSource.fetchMessagesBatch(
					ctx.mapping.sourcePath,
					nextNeed,
				);
			}
		}

		const currentFetch =
			prefetchedBatch ??
			resilientSource.fetchMessagesBatch(ctx.mapping.sourcePath, needBody);
		prefetchedBatch = undefined;

		let messages: FetchedMigrationMessage[];
		try {
			messages = await currentFetch;
		} catch {
			for (const uid of needBody) {
				await stageSingleUid({ ctx, uid, uploadQueue });
			}
			continue;
		}

		const byUid = new Map(messages.map((m) => [m.uid, m]));
		const stagedUids: number[] = [];

		for (const uid of needBody) {
			const msg = byUid.get(uid);
			if (!msg) {
				await stageSingleUid({ ctx, uid, uploadQueue });
				continue;
			}
			await persistToStaging(ctx, msg);
			stagedUids.push(uid);
		}

		if (stagedUids.length > 0) {
			await uploadQueue.push(stagedUids);
		}

		if (ctx.transfer.interBatchPauseMs > 0) {
			await Bun.sleep(ctx.transfer.interBatchPauseMs);
		}
	}
}

async function stageSingleUid(options: {
	ctx: TransferContext;
	uid: number;
	uploadQueue: TransferBatchQueue<number[]>;
}): Promise<void> {
	const { ctx, uid, uploadQueue } = options;
	let msg: FetchedMigrationMessage | undefined;
	for (let fetchAttempt = 0; fetchAttempt < 12; fetchAttempt++) {
		if (ctx.hooks.shouldStop()) return;
		await ctx.hooks.waitWhilePaused();
		if (ctx.hooks.shouldStop()) return;

		const batch = await ctx.resilientSource.fetchMessagesBatch(ctx.mapping.sourcePath, [uid]);
		msg = batch[0];
		if (msg) break;
		await sleepRespectingHooks(400 + fetchAttempt * 200, ctx.hooks);
	}
	if (!msg) {
		ctx.hooks.onMessageFailed(uid);
		ctx.markMessage(
			ctx.db,
			ctx.migrationId,
			ctx.mapping.sourcePath,
			uid,
			"failed",
			0,
			undefined,
			`Message UID ${uid} could not be read — will retry`,
		);
		return;
	}
	await persistToStaging(ctx, msg);
	await uploadQueue.push([uid]);
}

async function runFetchLane(options: {
	ctx: TransferContext;
	uids: number[];
	queue: TransferBatchQueue<FetchedMigrationMessage[]>;
}): Promise<void> {
	const { ctx, uids, queue } = options;
	const { resilientSource } = ctx;
	const { batches, envelopes } = await planFolderFetch(ctx, uids);
	let prefetchedBatch: Promise<FetchedMigrationMessage[]> | undefined;

	for (let b = 0; b < batches.length; b++) {
		if (ctx.hooks.shouldStop()) return;
		await ctx.hooks.waitWhilePaused();
		if (ctx.hooks.shouldStop()) return;

		const batchUids = batches[b]!;
		const needBody = await uidsNeedingBodyFetch(ctx, batchUids, envelopes);
		if (needBody.length === 0) {
			if (ctx.transfer.interBatchPauseMs > 0) {
				await Bun.sleep(ctx.transfer.interBatchPauseMs);
			}
			continue;
		}

		const nextBatch = batches[b + 1];
		if (!prefetchedBatch && nextBatch) {
			const nextNeed = await uidsNeedingBodyFetch(ctx, nextBatch, envelopes);
			if (nextNeed.length > 0) {
				prefetchedBatch = resilientSource.fetchMessagesBatch(
					ctx.mapping.sourcePath,
					nextNeed,
				);
			}
		}

		const currentFetch =
			prefetchedBatch ??
			resilientSource.fetchMessagesBatch(ctx.mapping.sourcePath, needBody);
		prefetchedBatch = undefined;

		let messages: FetchedMigrationMessage[];
		try {
			messages = await currentFetch;
		} catch {
			for (const uid of needBody) {
				await processUidWithRetries({ ctx, uid });
			}
			continue;
		}

		const byUid = new Map(messages.map((m) => [m.uid, m]));
		const fetched: FetchedMigrationMessage[] = [];
		const missingUids: number[] = [];

		for (const uid of needBody) {
			const msg = byUid.get(uid);
			if (msg) fetched.push(msg);
			else missingUids.push(uid);
		}

		if (fetched.length > 0) {
			await queue.push(fetched);
		}

		for (const uid of missingUids) {
			if (ctx.hooks.shouldStop()) return;
			await ctx.hooks.waitWhilePaused();
			if (ctx.hooks.shouldStop()) return;
			await processUidWithRetries({ ctx, uid });
		}

		if (ctx.transfer.interBatchPauseMs > 0) {
			await Bun.sleep(ctx.transfer.interBatchPauseMs);
		}
	}
}

async function processUidWithRetries(options: {
	ctx: TransferContext;
	uid: number;
	uploadQueue?: TransferBatchQueue<number[]>;
}): Promise<void> {
	let msg: FetchedMigrationMessage | undefined;
	for (let fetchAttempt = 0; fetchAttempt < 12; fetchAttempt++) {
		if (options.ctx.hooks.shouldStop()) return;
		await options.ctx.hooks.waitWhilePaused();
		if (options.ctx.hooks.shouldStop()) return;

		const batch = await options.ctx.resilientSource.fetchMessagesBatch(
			options.ctx.mapping.sourcePath,
			[options.uid],
		);
		msg = batch[0];
		if (msg) break;
		await sleepRespectingHooks(400 + fetchAttempt * 200, options.ctx.hooks);
		if (options.ctx.hooks.shouldStop()) return;
	}
	if (!msg) {
		options.ctx.hooks.onMessageFailed(options.uid);
		options.ctx.markMessage(
			options.ctx.db,
			options.ctx.migrationId,
			options.ctx.mapping.sourcePath,
			options.uid,
			"failed",
			0,
			undefined,
			`Message UID ${options.uid} could not be read — will retry`,
		);
		return;
	}
	if (options.ctx.staging) {
		await persistToStaging(options.ctx, msg);
		await options.uploadQueue!.push([options.uid]);
		return;
	}
	await transferSingleWithRetries(options.ctx, msg);
}

function emptyFetchedMessage(uid: number, messageId?: string): FetchedMigrationMessage {
	return {
		uid,
		source: Buffer.alloc(0),
		flags: new Set(),
		messageId,
	};
}

async function finalizeCopiedUid(ctx: TransferContext, uid: number, messageId?: string): Promise<void> {
	ctx.markMessage(
		ctx.db,
		ctx.migrationId,
		ctx.mapping.sourcePath,
		uid,
		"completed",
		0,
		messageId,
		undefined,
		0,
		null,
	);
	ctx.hooks.onMessageCompleted(uid, 0);
}

async function transferFolderServerCopy(
	ctx: TransferContext,
	pendingUids: number[],
): Promise<void> {
	const batchSize = ctx.transfer.fetchBatchSize;
	for (let i = 0; i < pendingUids.length; i += batchSize) {
		if (ctx.hooks.shouldStop()) return;
		await ctx.hooks.waitWhilePaused();
		if (ctx.hooks.shouldStop()) return;

		const batchUids = pendingUids.slice(i, i + batchSize);
		const envelopes = await ctx.resilientSource.runImap((client) =>
			fetchEnvelopeBatch(client, ctx.mapping.sourcePath, batchUids),
		);

		const toCopy: number[] = [];
		for (const env of envelopes) {
			const prepared = await prepareMessage(ctx, emptyFetchedMessage(env.uid, env.messageId));
			if (prepared === "skip" || prepared === null) continue;
			toCopy.push(env.uid);
		}

		if (toCopy.length === 0) continue;

		try {
			await ctx.resilientSource.runImap((client) =>
				copyMessagesUidBatch(
					client,
					ctx.mapping.sourcePath,
					ctx.mapping.destPath,
					toCopy,
				),
			);
			for (const env of envelopes) {
				if (!toCopy.includes(env.uid)) continue;
				await finalizeCopiedUid(ctx, env.uid, env.messageId);
			}
		} catch (error) {
			logger.warn(
				"migration",
				`Server-side COPY batch failed in ${ctx.mapping.sourcePath}, falling back per UID`,
				error instanceof Error ? error.message : String(error),
			);
			for (const uid of toCopy) {
				if (ctx.hooks.shouldStop()) return;
				try {
					await ctx.resilientSource.runImap((client) =>
						copyMessagesUidBatch(client, ctx.mapping.sourcePath, ctx.mapping.destPath, [uid]),
					);
					const env = envelopes.find((e) => e.uid === uid);
					await finalizeCopiedUid(ctx, uid, env?.messageId);
				} catch {
					await processUidWithRetries({ ctx, uid });
				}
			}
		}

		if (ctx.transfer.interBatchPauseMs > 0) {
			await Bun.sleep(ctx.transfer.interBatchPauseMs);
		}
		ctx.hooks.onBatchFinished?.();
	}
}

async function transferFolderTurboStaging(ctx: TransferContext, pendingUids: number[]): Promise<void> {
	const staging = ctx.staging!;
	const phase = ctx.transferPhase;
	const resumeStaged = listStagedUidsForFolder(ctx.migrationId, ctx.mapping.sourcePath);
	const resumeSet = new Set(resumeStaged);
	const fetchUids = pendingUids.filter((uid) => !resumeSet.has(uid));

	logger.info(
		"migration",
		`Turbo ${phase} ${ctx.mapping.sourcePath}: ${fetchUids.length} fetch, ${resumeStaged.length} staged upload`,
	);

	if (phase === "deliver") {
		const uploadQueue = new TransferBatchQueue<number[]>(ctx.transfer.pipelineQueueDepth);
		const uploadWorker = runUploadWorker(ctx, staging, uploadQueue);
		const batchSize = ctx.transfer.fetchBatchSize;
		const stagedToDeliver = stagedUidsForDeliver(
			ctx,
			resumeStaged.length > 0 ? resumeStaged : pendingUids,
		);
		for (let i = 0; i < stagedToDeliver.length; i += batchSize) {
			const batch = stagedToDeliver.slice(i, i + batchSize);
			if (batch.length > 0) await uploadQueue.push(batch);
		}
		uploadQueue.close();
		await uploadWorker;
		return;
	}

	if (phase === "ingest") {
		const noopQueue = new TransferBatchQueue<number[]>(1);
		await runStageLane({ ctx, uids: fetchUids, uploadQueue: noopQueue });
		noopQueue.close();
		return;
	}

	const uploadQueue = new TransferBatchQueue<number[]>(ctx.transfer.pipelineQueueDepth);
	const uploadWorker = runUploadWorker(ctx, staging, uploadQueue);

	const batchSize = ctx.transfer.fetchBatchSize;
	const stagedToDeliver = stagedUidsForDeliver(ctx, resumeStaged);
	for (let i = 0; i < stagedToDeliver.length; i += batchSize) {
		const batch = stagedToDeliver.slice(i, i + batchSize);
		if (batch.length > 0) await uploadQueue.push(batch);
	}

	await runStageLane({ ctx, uids: fetchUids, uploadQueue });
	uploadQueue.close();
	await uploadWorker;
}

async function transferFolderCoupled(ctx: TransferContext, pendingUids: number[]): Promise<void> {
	if (ctx.transferPhase === "deliver") return;

	const queue = new TransferBatchQueue<FetchedMigrationMessage[]>(
		ctx.transfer.pipelineQueueDepth,
	);
	const appendWorker =
		ctx.transferPhase === "ingest"
			? Promise.resolve()
			: runUploadWorkerCoupled(ctx, queue);

	await runFetchLane({ ctx, uids: pendingUids, queue });

	queue.close();
	await appendWorker;
}

async function runUploadWorkerCoupled(
	ctx: TransferContext,
	queue: TransferBatchQueue<FetchedMigrationMessage[]>,
): Promise<void> {
	while (true) {
		const batch = await queue.take();
		if (!batch) break;
		if (ctx.hooks.shouldStop()) continue;
		await transferBatchWithRetries(ctx, batch);
		ctx.hooks.onBatchFinished?.();
	}
}

export async function transferFolderWithLanes(options: {
	db: Database;
	migrationId: string;
	mapping: FolderMapping;
	resilientSource: ResilientMailSource;
	/** One appender per migration — serializes APPEND across all folders. */
	sharedDest: SharedDestAppender | null;
	pendingUids: number[];
	transfer: MigrationTransferConfig;
	backupRootPath: string | null;
	backupOnly: boolean;
	useServerSideCopy: boolean;
	transferPhase?: FolderTransferPhase;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	const {
		db,
		migrationId,
		mapping,
		resilientSource,
		pendingUids,
		transfer,
		backupRootPath: backupAccountDir,
		backupOnly,
		useServerSideCopy,
		transferPhase = "combined",
		markMessage,
		hooks,
		sharedDest,
	} = options;

	if (pendingUids.length === 0) return;

	const destMessageIds =
		sharedDest && transfer.skipDuplicates
			? await resolveDestinationDuplicateIds({
					client: sharedDest.imapClient,
					folderPath: mapping.destPath,
					fetchBatchSize: transfer.fetchBatchSize,
					db,
					migrationId,
					sourceFolder: mapping.sourcePath,
				})
			: new Set<string>();

	const staging = backupOnly
		? null
		: new MigrationStagingStore(migrationStagingRoot(migrationId));

	const ctx: TransferContext = {
		db,
		migrationId,
		mapping,
		transfer,
		destMessageIds,
		duplicateLock: createAsyncMutex(),
		backupAccountDir,
		markMessage,
		hooks,
		backupOnly,
		sharedDest,
		staging,
		resilientSource,
		useServerSideCopy,
		transferPhase,
	};

	if (useServerSideCopy && transferPhase !== "deliver") {
		await transferFolderServerCopy(ctx, pendingUids);
		return;
	}

	if (staging) {
		await transferFolderTurboStaging(ctx, pendingUids);
	} else {
		await transferFolderCoupled(ctx, pendingUids);
	}
}
