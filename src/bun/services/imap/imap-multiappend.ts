import type { ImapFlow } from "imapflow";
import { createRequire } from "node:module";
import type { AppendPayload } from "./imap-append-batch";

const require = createRequire(import.meta.url);
const imapTools = require("imapflow/lib/tools.js") as {
	normalizePath: (connection: unknown, path: string) => string;
	encodePath: (connection: unknown, path: string) => string;
	formatFlag: (flag: string) => string | false;
	canUseFlag: (mailbox: unknown, flag: string) => boolean;
	formatDateTime: (date: Date | string) => string;
};

type ImapExecConnection = ImapFlow & {
	capabilities: Map<string, number | boolean>;
	states: { AUTHENTICATED: string; SELECTED: string };
	state: string;
	mailbox: { path: string; permanentFlags?: Set<string> | string[] };
	exec: (
		command: string,
		attributes: Array<{
			type: string;
			value?: string | Buffer;
			isLiteral8?: boolean;
		}>,
		options: { untagged?: false },
	) => Promise<{ next: () => void }>;
	disableBinary?: boolean;
};

export function serverSupportsMultiAppend(client: ImapFlow): boolean {
	return (client as ImapExecConnection).capabilities.has("MULTIAPPEND");
}

function formatMessageFlags(connection: ImapExecConnection, flags?: string[]): string[] {
	return (Array.isArray(flags) ? flags : [])
		.map((flag) => flag && imapTools.formatFlag(flag.toString()))
		.filter((flag): flag is string => Boolean(flag && imapTools.canUseFlag(connection.mailbox, flag)));
}

function assertWithinAppendLimit(connection: ImapExecConnection, messages: AppendPayload[]): void {
	if (!connection.capabilities.has("APPENDLIMIT")) return;
	const limit = connection.capabilities.get("APPENDLIMIT");
	if (typeof limit !== "number") return;
	const total = messages.reduce((sum, msg) => sum + msg.source.byteLength, 0);
	if (total > limit) {
		throw new Error(`MULTIAPPEND batch too large for APPENDLIMIT=${limit}`);
	}
}

function buildMultiAppendAttributes(
	connection: ImapExecConnection,
	folderPath: string,
	messages: AppendPayload[],
): Array<{ type: string; value?: string | Buffer; isLiteral8?: boolean }> {
	const destination = imapTools.normalizePath(connection, folderPath);
	const attributes: Array<{ type: string; value?: string | Buffer; isLiteral8?: boolean }> = [
		{ type: "ATOM", value: imapTools.encodePath(connection, destination) },
	];

	for (const msg of messages) {
		const flags = formatMessageFlags(connection, msg.flags);
		const idate = msg.internalDate ? imapTools.formatDateTime(msg.internalDate) : false;

		if (flags.length || idate) {
			attributes.push(...flags.map((flag) => ({ type: "ATOM", value: flag })));
		}
		if (idate) {
			attributes.push({ type: "STRING", value: idate });
		}

		let isLiteral8 = false;
		if (connection.capabilities.has("BINARY") && !connection.disableBinary) {
			isLiteral8 = msg.source.indexOf(0) >= 0;
		}
		attributes.push({ type: "LITERAL", value: msg.source, isLiteral8 });
	}

	return attributes;
}

/** RFC 3502 MULTIAPPEND — multiple messages in one APPEND round trip. */
export async function appendMessagesMulti(
	client: ImapFlow,
	folderPath: string,
	messages: AppendPayload[],
): Promise<void> {
	if (messages.length === 0) return;
	const connection = client as ImapExecConnection;
	assertWithinAppendLimit(connection, messages);
	const attributes = buildMultiAppendAttributes(connection, folderPath, messages);
	const response = await connection.exec("APPEND", attributes, { untagged: false });
	response.next();
}

/** Prefer MULTIAPPEND when supported; fall back to sequential APPEND. */
export async function appendMessagesOptimized(
	client: ImapFlow,
	folderPath: string,
	messages: AppendPayload[],
): Promise<void> {
	if (messages.length === 0) return;

	const lock = await client.getMailboxLock(folderPath);
	try {
		if (messages.length > 1 && serverSupportsMultiAppend(client)) {
			try {
				await appendMessagesMulti(client, folderPath, messages);
				return;
			} catch {
				/* sequential fallback */
			}
		}
		for (const msg of messages) {
			await client.append(folderPath, msg.source, msg.flags, msg.internalDate);
		}
	} finally {
		lock.release();
	}
}
