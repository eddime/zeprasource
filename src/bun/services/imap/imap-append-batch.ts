import type { ImapFlow } from "imapflow";
import type { FetchedMigrationMessage } from "./imap-client";
import { flagsToArray } from "./imap-client";

export type AppendPayload = {
	source: Buffer;
	flags?: string[];
	internalDate?: Date;
};

/** One mailbox lock, sequential APPENDs — avoids lock churn and server contention. */
export async function appendMessagesBatch(
	client: ImapFlow,
	folderPath: string,
	messages: AppendPayload[],
): Promise<void> {
	if (messages.length === 0) return;
	const lock = await client.getMailboxLock(folderPath);
	try {
		for (const msg of messages) {
			await client.append(
				folderPath,
				msg.source,
				msg.flags,
				msg.internalDate,
			);
		}
	} finally {
		lock.release();
	}
}

export function toAppendPayload(
	msg: FetchedMigrationMessage,
	preserveFlags: boolean,
): AppendPayload {
	return {
		source: msg.source,
		flags: preserveFlags ? flagsToArray(msg.flags) : undefined,
		internalDate: msg.internalDate,
	};
}
