import { isPop3Access } from "../../../shared/mail-access";
import type { MailboxCredentials } from "../../../shared/types";
import {
	connectImapClient,
	fetchFolderUids,
	fetchMessagesBatch,
	safeCloseImapClient,
	type FetchedMigrationMessage,
} from "../imap/imap-client";
import {
	createPop3Session,
	fetchPop3FolderUids,
	fetchPop3MessagesBatch,
	normalizePop3Credentials,
	type Pop3Session,
} from "../pop/pop-client";
import type { ImapFlow } from "imapflow";

export type MailSourceSession =
	| { protocol: "imap"; client: ImapFlow }
	| { protocol: "pop3"; client: Pop3Session };

export async function openMailSource(
	credentials: MailboxCredentials,
): Promise<MailSourceSession> {
	if (isPop3Access(credentials.accessProtocol)) {
		const client = await createPop3Session(normalizePop3Credentials(credentials));
		return { protocol: "pop3", client };
	}
	const client = await connectImapClient(credentials, "migration");
	return { protocol: "imap", client };
}

export async function closeMailSource(session: MailSourceSession): Promise<void> {
	if (session.protocol === "pop3") {
		try {
			await session.client.quit();
		} catch {
			session.client.close();
		}
		return;
	}
	await safeCloseImapClient(session.client);
}

export async function fetchSourceFolderUids(
	session: MailSourceSession,
	folderPath: string,
): Promise<number[]> {
	if (session.protocol === "pop3") {
		return fetchPop3FolderUids(session.client, folderPath);
	}
	return fetchFolderUids(session.client, folderPath);
}

export async function fetchSourceMessagesBatch(
	session: MailSourceSession,
	folderPath: string,
	uids: number[],
): Promise<FetchedMigrationMessage[]> {
	if (session.protocol === "pop3") {
		return fetchPop3MessagesBatch(session.client, folderPath, uids);
	}
	return fetchMessagesBatch(session.client, folderPath, uids);
}
