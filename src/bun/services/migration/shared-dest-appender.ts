import type { ImapFlow } from "imapflow";
import type { MailboxCredentials } from "../../../shared/types";
import {
	appendMessagesOptimized,
	type AppendPayload,
} from "../imap/imap-append-batch";
import { connectImapClient, safeCloseImapClient } from "../imap/imap-client";
import {
	setImapSessionPrefs,
	shouldRetryImapWithoutCompression,
} from "../imap/imap-compression";
import { classifyMigrationError } from "./migration-errors";
import { MESSAGE_TRANSFER_TIMEOUT_MS } from "./migration-constants";

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

/**
 * Single destination IMAP session for all transfer lanes.
 * Parallel lanes FETCH from source; APPEND is serialized here (imapsync-style).
 */
export class SharedDestAppender {
	private client: ImapFlow;
	private readonly creds: MailboxCredentials;
	private readonly appendMutex = createAsyncMutex();

	constructor(client: ImapFlow, creds: MailboxCredentials) {
		this.client = client;
		this.creds = creds;
	}

	get imapClient(): ImapFlow {
		return this.client;
	}

	async reconnect(): Promise<void> {
		await safeCloseImapClient(this.client);
		this.client = await connectImapClient(this.creds, "migration");
	}

	private async runAppendOnce(
		folderPath: string,
		messages: AppendPayload[],
	): Promise<void> {
		const batchTimeoutMs = Math.min(
			600_000,
			MESSAGE_TRANSFER_TIMEOUT_MS * Math.max(1, Math.ceil(messages.length / 5)),
		);
		await withTimeout(
			appendMessagesOptimized(this.client, folderPath, messages),
			batchTimeoutMs,
			`Append batch to ${folderPath}`,
		);
	}

	private async runAppendWithReconnect(
		folderPath: string,
		messages: AppendPayload[],
	): Promise<void> {
		let lastError: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				await this.runAppendOnce(folderPath, messages);
				return;
			} catch (error) {
				lastError = error;
				const classification = classifyMigrationError(error);
				if (attempt === 0 && (classification.reconnect || shouldRetryImapWithoutCompression(error))) {
					if (shouldRetryImapWithoutCompression(error)) {
						setImapSessionPrefs(this.creds, { disableCompression: true });
					}
					await this.reconnect();
					continue;
				}
				throw error;
			}
		}
		throw lastError;
	}

	/** Halve batch on failure to isolate bad messages (imapsync-style per-message recovery). */
	private async appendBatchSplit(
		folderPath: string,
		messages: AppendPayload[],
	): Promise<void> {
		try {
			await this.runAppendWithReconnect(folderPath, messages);
		} catch (error) {
			if (messages.length <= 1) throw error;
			const mid = Math.ceil(messages.length / 2);
			await this.appendBatchSplit(folderPath, messages.slice(0, mid));
			await this.appendBatchSplit(folderPath, messages.slice(mid));
		}
	}

	async appendBatch(folderPath: string, messages: AppendPayload[]): Promise<void> {
		if (messages.length === 0) return;
		await this.appendMutex.run(() => this.appendBatchSplit(folderPath, messages));
	}
}
