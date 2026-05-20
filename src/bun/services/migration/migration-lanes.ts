import type { Database } from "bun:sqlite";
import type { FolderMapping, MailboxCredentials } from "../../../shared/types";
import type { AppSettings } from "../../../shared/types";
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
) => void;

async function transferMessage(
	db: Database,
	migrationId: string,
	mapping: FolderMapping,
	msg: FetchedMigrationMessage,
	settings: AppSettings,
	destClient: Awaited<ReturnType<typeof createImapClient>>,
	destMessageIds: Set<string>,
	duplicateLock: ReturnType<typeof createAsyncMutex>,
	markMessage: MarkMessageFn,
	hooks: FolderTransferHooks,
): Promise<void> {
	const { uid, source, flags, internalDate, messageId } = msg;

	let reservedMessageIdKey: string | undefined;
	if (settings.skipDuplicates && messageId) {
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

	const flagList = settings.preserveFlags ? flagsToArray(flags) : undefined;
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
	settings: AppSettings;
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
		settings,
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

		for (let i = 0; i < uids.length; i += MIGRATION_FETCH_BATCH_SIZE) {
			if (hooks.shouldStop()) return;
			await hooks.waitWhilePaused();
			if (hooks.shouldStop()) return;

			const batchUids = uids.slice(i, i + MIGRATION_FETCH_BATCH_SIZE);
			let messages: FetchedMigrationMessage[];
			try {
				messages = await fetchMessagesBatch(sourceClient, mapping.sourcePath, batchUids);
			} catch {
				for (const uid of batchUids) {
					await processUidWithRetries({
						db,
						migrationId,
						mapping,
						uid,
						sourceClient,
						destClient,
						settings,
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
						settings,
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
					settings,
					destMessageIds,
					duplicateLock,
					markMessage,
					hooks,
				});
			}
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
	settings: AppSettings;
	destMessageIds: Set<string>;
	duplicateLock: ReturnType<typeof createAsyncMutex>;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	const { msg, settings, hooks, markMessage, db, migrationId, mapping } = options;
	let attempt = 0;
	while (attempt < settings.retryAttempts) {
		try {
			await transferMessage(
				db,
				migrationId,
				mapping,
				msg,
				settings,
				options.destClient,
				options.destMessageIds,
				options.duplicateLock,
				markMessage,
				hooks,
			);
			return;
		} catch (error) {
			attempt += 1;
			if (attempt >= settings.retryAttempts) {
				hooks.onMessageFailed(msg.uid);
				const errMsg = error instanceof Error ? error.message : "Transfer failed";
				markMessage(
					db,
					migrationId,
					mapping.sourcePath,
					msg.uid,
					"failed",
					0,
					msg.messageId,
					errMsg,
				);
				logger.error("migration", `Failed UID ${msg.uid} in ${mapping.sourcePath}`, errMsg);
			} else {
				await Bun.sleep(500 * attempt);
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
	settings: AppSettings;
	destMessageIds: Set<string>;
	duplicateLock: ReturnType<typeof createAsyncMutex>;
	markMessage: MarkMessageFn;
	hooks: FolderTransferHooks;
}): Promise<void> {
	const batch = await fetchMessagesBatch(
		options.sourceClient,
		options.mapping.sourcePath,
		[options.uid],
	);
	const msg = batch[0];
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
			`Message UID ${options.uid} has no source`,
		);
		return;
	}
	await processFetchedWithRetries({
		db: options.db,
		migrationId: options.migrationId,
		mapping: options.mapping,
		msg,
		destClient: options.destClient,
		settings: options.settings,
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
	settings: AppSettings;
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
		settings,
		markMessage,
		hooks,
	} = options;

	if (pendingUids.length === 0) return;

	const destMessageIds = settings.skipDuplicates
		? await buildDestinationMessageIdIndex(destClient, mapping.destPath)
		: new Set<string>();
	const duplicateLock = createAsyncMutex();
	const shards = shardUids(pendingUids, settings.parallelConnections);

	await Promise.all(
		shards.map((uids) =>
			runMigrationLane({
				db,
				migrationId,
				mapping,
				sourceCreds,
				destCreds,
				uids,
				settings,
				destMessageIds,
				duplicateLock,
				markMessage,
				hooks,
			}),
		),
	);
}
