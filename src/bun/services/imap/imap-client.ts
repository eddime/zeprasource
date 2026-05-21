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
import {
	describeImapCompression,
	getImapSessionPrefs,
	isImapDeflateActive,
	preferImapCompression,
	serverAdvertisesCompress,
	setImapSessionPrefs,
	shouldRetryImapWithoutCompression,
} from "./imap-compression";

export {
	describeImapCompression,
	isImapDeflateActive,
	serverAdvertisesCompress,
} from "./imap-compression";

/** Shorter timeouts for probes/tests; longer for live migration transfers. */
export type ImapClientMode = "migration" | "test" | "probe";

const loggedMigrationConnects = new Set<string>();

function logMigrationConnectOnce(
	credentials: MailboxCredentials,
	mode: ImapClientMode,
	wire: string,
): void {
	if (mode !== "migration") return;
	const key = `${credentials.host}:${credentials.port}`;
	if (loggedMigrationConnects.has(key)) return;
	loggedMigrationConnects.add(key);
	logger.info("imap", `Source/dest session ${key} wire=${wire} (reused for all folders)`);
}

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

/** Shared hosting often presents a hoster cert for the customer's mail hostname. */
export function isImapTlsHostnameMismatch(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const extra = error as Error & { code?: string };
	const text = `${extra.code ?? ""} ${error.message}`;
	return /Hostname\/IP does not match certificate|ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(
		text,
	);
}

function shouldRetryImapWithRelaxedTls(
	error: unknown,
	relaxedTls: boolean,
	credentials: MailboxCredentials,
): boolean {
	if (relaxedTls) return false;
	if (isImapTlsHostnameMismatch(error)) return true;
	// STARTTLS on 143: cert mismatch often surfaces as abrupt close, not a clear TLS message.
	if (!credentials.secure && credentials.port === 143) {
		const extra = error as Error & { code?: string };
		return (
			extra.code === "ClosedAfterConnectText" ||
			/ECONNRESET|Unexpected close|closed/i.test(error.message)
		);
	}
	return false;
}

export async function connectImapClient(
	raw: MailboxCredentials,
	mode: ImapClientMode = "migration",
): Promise<ImapFlow> {
	const credentials = normalizeMailboxCredentials(raw);
	const tlsAttempts: boolean[] = credentials.relaxedTls ? [true] : [false, true];
	const wantCompression = preferImapCompression(credentials.host, mode);
	let lastError: unknown;

	for (const relaxedTls of tlsAttempts) {
		const compressionAttempts = wantCompression ? [false, true] : [true];

		for (const disableCompression of compressionAttempts) {
			setImapSessionPrefs(credentials, { disableCompression });
			let client: ImapFlow | null = null;
			try {
				client = await createImapClient(
					{ ...credentials, relaxedTls },
					mode,
					disableCompression,
				);
				await client.connect();
				logMigrationConnectOnce(
					credentials,
					mode,
					describeImapCompression(client),
				);
				return client;
			} catch (error) {
				lastError = error;
				if (client) await safeCloseImapClient(client);

				if (disableCompression) continue;
				if (!wantCompression || !shouldRetryImapWithoutCompression(error)) {
					break;
				}
				logger.warn(
					"imap",
					`COMPRESS=DEFLATE failed for ${credentials.host}, retrying without compression`,
					error instanceof Error ? error.message : String(error),
				);
			}
		}

		if (!shouldRetryImapWithRelaxedTls(lastError, relaxedTls, credentials)) break;
	}

	throw lastError;
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
	disableCompression?: boolean,
): Promise<ImapFlow> {
	const credentials = normalizeMailboxCredentials(raw);
	const user = credentials.username || credentials.email;
	const prefs = getImapSessionPrefs(credentials);
	const noCompress =
		disableCompression ?? prefs.disableCompression ?? !preferImapCompression(credentials.host, mode);

	const timeouts = IMAP_TIMEOUTS[mode];
	const client = new ImapFlow({
		host: credentials.host,
		port: credentials.port,
		secure: credentials.secure,
		auth: { user, pass: credentials.password ?? "" },
		logger: false,
		disableCompression: noCompress,
		...timeouts,
		tls: {
			rejectUnauthorized: !credentials.relaxedTls,
			minVersion: "TLSv1.2",
			servername: credentials.host,
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

	const client = await connectImapClient(credentials, "test");
	try {
		const mailboxes = await client.list({ statusQuery: { messages: true } });
		const folders: ImapFolder[] = [];
		for (const box of mailboxes.filter((entry) => !entry.flags?.has("\\Noselect"))) {
			let messageCount = box.status?.messages;
			if (typeof messageCount !== "number") {
				try {
					const status = await client.status(box.path, { messages: true });
					messageCount = status.messages ?? 0;
				} catch {
					messageCount = 0;
				}
			}
			folders.push({
				path: box.path,
				name: box.name,
				delimiter: box.delimiter,
				attributes: Array.from(box.flags ?? []),
				messageCount,
			});
		}
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

export type FetchedEnvelope = {
	uid: number;
	messageId?: string;
};

/** Lightweight FETCH for server-side COPY duplicate checks. */
export async function fetchEnvelopeBatch(
	client: ImapFlow,
	folderPath: string,
	uids: number[],
): Promise<FetchedEnvelope[]> {
	if (uids.length === 0) return [];
	const lock = await client.getMailboxLock(folderPath);
	try {
		const results: FetchedEnvelope[] = [];
		for await (const msg of client.fetch(uids, { envelope: true }, { uid: true })) {
			if (!msg.uid) continue;
			results.push({
				uid: msg.uid,
				messageId: msg.envelope?.messageId,
			});
		}
		return results;
	} finally {
		lock.release();
	}
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

export { measureFolderSizes } from "./imap-folder-measure";

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
