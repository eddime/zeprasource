import type { ImapFlow } from "imapflow";

/** Server-side COPY (same account, same IMAP endpoint) — no message body over the wire. */
export async function copyMessagesUidBatch(
	client: ImapFlow,
	sourceFolder: string,
	destFolder: string,
	uids: number[],
): Promise<void> {
	if (uids.length === 0) return;
	const lock = await client.getMailboxLock(sourceFolder);
	try {
		const result = await client.messageCopy(uids, destFolder, { uid: true });
		if (result === false) {
			throw new Error(`IMAP COPY to ${destFolder} was rejected by the server`);
		}
	} finally {
		lock.release();
	}
}
