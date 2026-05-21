import { ImapFlow } from "imapflow";
import type {
	ConnectionTestResult,
	FolderSizeEstimate,
	ImapFolder,
	MailboxCredentials,
	MigrationSizeEstimate,
} from "../../../shared/types";
import { buildMigrationSizeEstimate } from "../../../shared/migration-size-estimate";
import { getMigrationPricingCatalog } from "../stripe/migration-pricing-catalog";
import { logger } from "../../utils/logger";
import {
	formatImapError,
	normalizeMailboxCredentials,
	validateMailboxCredentials,
} from "./credentials";

/** Shorter timeouts for probes/tests; longer for live migration transfers. */
export type ImapClientMode = "migration" | "test" | "probe";

const IMAP_TIMEOUTS: Record<
	ImapClientMode,
	{ connectionTimeout: number; greetingTimeout: number; socketTimeout: number }
> = {
	probe: { connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 8_000 },
	test: { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 },
	migration: { connectionTimeout: 30_000, greetingTimeout: 20_000, socketTimeout: 120_000 },
};

function attachImapErrorGuard(client: ImapFlow, host: string): void {
	client.on("error", (err) => {
		logger.debug("imap", `Background socket error (${host}): ${err.message}`);
	});
}

export async function safeCloseImapClient(client: ImapFlow): Promise<void> {
	client.removeAllListeners("error");
	try {
		if (client.usable) {
			await client.logout();
		}
	} catch {
		/* not connected */
	}
	try {
		await client.close();
	} catch {
		/* already closed */
	}
}

export async function createImapClient(
	raw: MailboxCredentials,
	mode: ImapClientMode = "migration",
): Promise<ImapFlow> {
	const credentials = normalizeMailboxCredentials(raw);
	const user = credentials.username || credentials.email;

	const timeouts = IMAP_TIMEOUTS[mode];
	const client = new ImapFlow({
		host: credentials.host,
		port: credentials.port,
		secure: credentials.secure,
		auth: { user, pass: credentials.password ?? "" },
		logger: false,
		...timeouts,
		tls: {
			rejectUnauthorized: true,
			minVersion: "TLSv1.2",
		},
		emitLogs: false,
	});

	attachImapErrorGuard(client, credentials.host);
	return client;
}

export async function testImapConnection(
	raw: MailboxCredentials,
): Promise<ConnectionTestResult> {
	const credentials = normalizeMailboxCredentials(raw);
	const validationError = validateMailboxCredentials(credentials);
	if (validationError) {
		return { success: false, error: validationError };
	}

	const client = await createImapClient(credentials, "test");
	try {
		await client.connect();
		const mailboxes = await client.list();
		const folders: ImapFolder[] = mailboxes
			.filter((box) => !box.flags?.has("\\Noselect"))
			.map((box) => ({
				path: box.path,
				name: box.name,
				delimiter: box.delimiter,
				attributes: Array.from(box.flags ?? []),
			}));
		await client.logout();
		return { success: true, folders };
	} catch (error) {
		const message = formatImapError(error, credentials);
		logger.warn("imap", `Connection test failed for ${credentials.email}`, message);
		return { success: false, error: message };
	} finally {
		await safeCloseImapClient(client);
	}
}

export async function fetchFolderUids(
	client: ImapFlow,
	folderPath: string,
): Promise<number[]> {
	const lock = await client.getMailboxLock(folderPath);
	try {
		if (!client.mailbox || typeof client.mailbox === "boolean") return [];
		const uids = await client.search({ all: true }, { uid: true });
		return Array.isArray(uids) ? uids : [];
	} finally {
		lock.release();
	}
}

export type FetchedMigrationMessage = {
	uid: number;
	source: Buffer;
	flags: Set<string>;
	internalDate?: Date;
	messageId?: string;
};

function parseFetchedMessage(
	uid: number,
	fetched: {
		source?: Buffer;
		flags?: Set<string>;
		internalDate?: Date | string;
		envelope?: { messageId?: string };
	},
): FetchedMigrationMessage | null {
	if (!fetched.source) return null;
	const internalDate =
		fetched.internalDate instanceof Date
			? fetched.internalDate
			: fetched.internalDate
				? new Date(fetched.internalDate)
				: undefined;
	return {
		uid,
		source: fetched.source,
		flags: fetched.flags ?? new Set(),
		internalDate,
		messageId: fetched.envelope?.messageId,
	};
}

export async function fetchMessagesBatch(
	client: ImapFlow,
	folderPath: string,
	uids: number[],
): Promise<FetchedMigrationMessage[]> {
	if (uids.length === 0) return [];
	const lock = await client.getMailboxLock(folderPath);
	try {
		const results: FetchedMigrationMessage[] = [];
		for await (const msg of client.fetch(
			uids,
			{ source: true, flags: true, internalDate: true, envelope: true },
			{ uid: true },
		)) {
			if (!msg.uid) continue;
			const parsed = parseFetchedMessage(msg.uid, msg);
			if (parsed) results.push(parsed);
		}
		return results;
	} finally {
		lock.release();
	}
}

export async function fetchMessageSource(
	client: ImapFlow,
	folderPath: string,
	uid: number,
): Promise<FetchedMigrationMessage> {
	const batch = await fetchMessagesBatch(client, folderPath, [uid]);
	const msg = batch[0];
	if (!msg) {
		throw new Error(`Message UID ${uid} has no source`);
	}
	return msg;
}

export async function appendMessage(
	client: ImapFlow,
	folderPath: string,
	source: Buffer,
	options: {
		flags?: string[];
		internalDate?: Date;
	},
): Promise<void> {
	const lock = await client.getMailboxLock(folderPath);
	try {
		await client.append(
			folderPath,
			source,
			options.flags,
			options.internalDate,
		);
	} finally {
		lock.release();
	}
}

export async function ensureFolderExists(
	client: ImapFlow,
	folderPath: string,
): Promise<void> {
	try {
		await client.mailboxOpen(folderPath);
		await client.mailboxClose();
	} catch {
		const parts = folderPath.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			try {
				await client.mailboxCreate(current);
			} catch {
				/* folder may already exist */
			}
		}
	}
}

export function flagsToArray(flags: Set<string> | undefined): string[] {
	if (!flags) return [];
	return Array.from(flags);
}

const SIZE_FETCH_BATCH = 500;

export async function measureFolderSizes(
	credentials: MailboxCredentials,
	folderPaths: string[],
): Promise<FolderSizeEstimate[]> {
	const normalized = normalizeMailboxCredentials(credentials);
	const client = await createImapClient(normalized, "test");
	const folders: FolderSizeEstimate[] = [];

	try {
		await client.connect();
		for (const folderPath of folderPaths) {
			const lock = await client.getMailboxLock(folderPath);
			try {
				const uids = await client.search({ all: true }, { uid: true });
				const uidList = Array.isArray(uids) ? uids : [];
				let folderBytes = 0;

				for (let i = 0; i < uidList.length; i += SIZE_FETCH_BATCH) {
					const batch = uidList.slice(i, i + SIZE_FETCH_BATCH);
					for await (const msg of client.fetch(batch, { size: true }, { uid: true })) {
						folderBytes += msg.size ?? 0;
					}
				}

				folders.push({
					path: folderPath,
					messages: uidList.length,
					bytes: folderBytes,
				});
			} finally {
				lock.release();
			}
		}
		await client.logout();
	} catch (error) {
		const message = formatImapError(error, normalized);
		throw new Error(message);
	} finally {
		await safeCloseImapClient(client);
	}

	return folders;
}

export async function estimateMigrationSize(
	source: MailboxCredentials,
	folderPaths: string[],
	destination?: MailboxCredentials,
): Promise<MigrationSizeEstimate> {
	const folders = await measureFolderSizes(source, folderPaths);
	const catalog = await getMigrationPricingCatalog();

	return buildMigrationSizeEstimate({
		folders,
		sourceProvider: source.provider,
		destProvider: destination?.provider ?? "generic",
		pricing: {
			configured: catalog.configured,
			freeLimitBytes: catalog.configured ? catalog.freeLimitBytes : 0,
		},
	});
}
