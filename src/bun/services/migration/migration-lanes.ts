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
import { MIGRATION_FETCH_BATCH_SIZE } from "./migration-constants";
import {
	classifyMigrationError,
	type MigrationErrorClassification,
} from "./migration-errors";
import { computeRetryDelay } from "./retry-policy";

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

async function transferMessage(
	db: Database,
	migrationId: string,
	mapping: FolderMapping,
	msg: FetchedMigrationMessage,
	transfer: MigrationTransferConfig,
	destClient: Awaited<ReturnType<typeof createImapClient>>,
	destMessageIds: Set<string>,
	duplicateLock: ReturnType<typeof createAsyncMutex>,
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
		await appendMessage(destClient, mapping.destPath, source, {
			flags: flagList,
			internalDate,
		});
	} catch (error) {
		if (reservedMessageIdKey) {
			await duplicateLock.run(async () => {
				destMessageIds.delete(reservedMessageIdKey!);
			});
		}
		throw error;
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
					markMessage,
					hooks,
				});
			}
			hooks.onBatchFinished?.();
		}
	} finally {
		await safeCloseImapClient(sourceClient);
		await safeCloseImapClient(destClient);
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
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	const { msg, transfer, hooks, markMessage, db, migrationId, mapping } = options;
	let attempt = 0;
	while (attempt < transfer.maxRetryAttempts) {
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
				const retryAfterMs = computeRetryDelay(attempt);
				hooks.onRetry?.(msg.uid, classification, retryAfterMs);
				await Bun.sleep(retryAfterMs);
			}
		}
	}
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
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	let msg: FetchedMigrationMessage | undefined;
	for (let fetchAttempt = 0; fetchAttempt < 12; fetchAttempt++) {
		const batch = await fetchMessagesBatch(
			options.sourceClient,
			options.mapping.sourcePath,
			[options.uid],
		);
		msg = batch[0];
		if (msg) break;
		await Bun.sleep(400 + fetchAttempt * 200);
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
				markMessage,
				hooks,
			}),
		),
	);
}
