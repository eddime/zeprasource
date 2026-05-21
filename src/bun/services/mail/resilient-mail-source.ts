import type { MailboxCredentials } from "../../../shared/types";
import {
	classifyMigrationError,
} from "../migration/migration-errors";
import {
	closeMailSource,
	fetchSourceFolderUids,
	fetchSourceMessagesBatch,
	openMailSource,
	type MailSourceSession,
} from "./mail-source";
import type { ImapFlow } from "imapflow";
import {
	fetchEnvelopeBatch,
	type FetchedEnvelope,
	type FetchedMigrationMessage,
} from "../imap/imap-client";

const MAX_RECONNECT_ATTEMPTS = 3;

export class ResilientMailSource {
	private session: MailSourceSession;

	constructor(
		private readonly credentials: MailboxCredentials,
		session: MailSourceSession,
	) {
		this.session = session;
	}

	get current(): MailSourceSession {
		return this.session;
	}

	async close(): Promise<void> {
		await closeMailSource(this.session);
	}

	private async reconnect(): Promise<void> {
		await closeMailSource(this.session);
		this.session = await openMailSource(this.credentials);
	}

	private async runWithReconnect<T>(fn: (session: MailSourceSession) => Promise<T>): Promise<T> {
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
			try {
				return await fn(this.session);
			} catch (error) {
				lastError = error;
				const classification = classifyMigrationError(error);
				if (!classification.reconnect || attempt >= MAX_RECONNECT_ATTEMPTS - 1) {
					throw error;
				}
				await this.reconnect();
			}
		}
		throw lastError;
	}

	fetchFolderUids(folderPath: string): Promise<number[]> {
		return this.runWithReconnect((session) => fetchSourceFolderUids(session, folderPath));
	}

	fetchMessagesBatch(folderPath: string, uids: number[]): Promise<FetchedMigrationMessage[]> {
		return this.runWithReconnect((session) =>
			fetchSourceMessagesBatch(session, folderPath, uids),
		);
	}

	fetchEnvelopeBatch(folderPath: string, uids: number[]): Promise<FetchedEnvelope[]> {
		return this.runImap((client) => fetchEnvelopeBatch(client, folderPath, uids));
	}

	/** IMAP-only operations (COPY, envelope fetch) with reconnect. */
	runImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
		return this.runWithReconnect((session) => {
			if (session.protocol !== "imap") {
				throw new Error("This migration path requires IMAP on the source mailbox");
			}
			return fn(session.client);
		});
	}
}
