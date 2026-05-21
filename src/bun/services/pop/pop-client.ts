import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { POP3_INBOX_PATH } from "../../../shared/mail-access";
import type {
	ConnectionTestResult,
	FolderSizeEstimate,
	ImapFolder,
	MailboxCredentials,
} from "../../../shared/types";
import {
	normalizeMailboxCredentials,
	validateMailboxCredentials,
} from "../imap/credentials";
import { formatImapError } from "../imap/credentials";
import type { FetchedMigrationMessage } from "../imap/imap-client";

type PopSocket = Socket | TLSSocket;

const CRLF = "\r\n";

export class Pop3Session {
	private socket: PopSocket | null = null;
	private buffer = "";

	constructor(private readonly credentials: MailboxCredentials) {}

	async connect(): Promise<void> {
		const { host, port, secure } = this.credentials;
		if (secure) {
			this.socket = await new Promise<TLSSocket>((resolve, reject) => {
				const sock = tlsConnect(
					{
						host,
						port,
						servername: host,
						rejectUnauthorized: true,
						minVersion: "TLSv1.2",
					},
					() => resolve(sock),
				);
				sock.once("error", reject);
			});
		} else {
			this.socket = await new Promise<Socket>((resolve, reject) => {
				const sock = netConnect({ host, port }, () => resolve(sock));
				sock.once("error", reject);
			});
		}
		const greeting = await this.readLine();
		if (!greeting.ok) {
			throw new Error("POP3 server did not respond.");
		}
	}

	async login(): Promise<void> {
		const user = this.credentials.username?.trim() || this.credentials.email.trim();
		const pass = this.credentials.password ?? "";
		const userRes = await this.command(`USER ${user}`);
		if (!userRes.ok) {
			throw new Error(userRes.line || "POP3 login failed.");
		}
		const passRes = await this.command(`PASS ${pass}`);
		if (!passRes.ok) {
			throw new Error(passRes.line || "POP3 login failed.");
		}
	}

	async stat(): Promise<{ count: number; octets: number }> {
		const res = await this.command("STAT");
		if (!res.ok) throw new Error(res.line || "POP3 STAT failed.");
		const parts = res.line.split(/\s+/);
		const count = Number.parseInt(parts[1] ?? "0", 10);
		const octets = Number.parseInt(parts[2] ?? "0", 10);
		return {
			count: Number.isFinite(count) ? count : 0,
			octets: Number.isFinite(octets) ? octets : 0,
		};
	}

	async uidl(): Promise<Map<number, string>> {
		const res = await this.command("UIDL", true);
		if (!res.ok) throw new Error(res.line || "POP3 UIDL failed.");
		const map = new Map<number, string>();
		for (const line of res.multiline ?? []) {
			const m = line.match(/^(\d+)\s+(\S+)/);
			if (!m) continue;
			map.set(Number.parseInt(m[1]!, 10), m[2]!);
		}
		return map;
	}

	async retr(messageNumber: number): Promise<Buffer> {
		const res = await this.command(`RETR ${messageNumber}`, true);
		if (!res.ok) throw new Error(res.line || `POP3 RETR ${messageNumber} failed.`);
		const raw = (res.multiline ?? []).join(CRLF);
		return Buffer.from(raw, "utf8");
	}

	async quit(): Promise<void> {
		try {
			await this.command("QUIT");
		} catch {
			/* closing anyway */
		}
		this.close();
	}

	close(): void {
		try {
			this.socket?.destroy();
		} catch {
			/* closed */
		}
		this.socket = null;
	}

	private async command(
		line: string,
		multiline = false,
	): Promise<{ ok: boolean; line: string; multiline?: string[] }> {
		if (!this.socket) throw new Error("POP3 not connected.");
		this.socket.write(`${line}${CRLF}`);
		const first = await this.readLine();
		if (!multiline) return first;
		if (!first.ok) return first;
		const lines: string[] = [];
		while (true) {
			const next = await this.readLineRaw();
			if (next === ".") break;
			lines.push(next.startsWith("..") ? next.slice(1) : next);
		}
		return { ok: true, line: first.line, multiline: lines };
	}

	private onData(chunk: Buffer): void {
		this.buffer += chunk.toString("utf8");
	}

	private attachData(): void {
		this.socket?.on("data", (chunk) => this.onData(chunk));
	}

	private async readLine(): Promise<{ ok: boolean; line: string }> {
		const line = await this.readLineRaw();
		const ok = line.startsWith("+OK");
		return { ok, line };
	}

	private readLineRaw(): Promise<string> {
		return new Promise((resolve, reject) => {
			const tryRead = () => {
				const idx = this.buffer.indexOf(CRLF);
				if (idx >= 0) {
					const line = this.buffer.slice(0, idx);
					this.buffer = this.buffer.slice(idx + CRLF.length);
					resolve(line);
					return;
				}
				if (!this.socket) {
					reject(new Error("POP3 connection closed."));
					return;
				}
				this.socket.once("data", () => tryRead());
				this.socket.once("error", reject);
				this.socket.once("close", () => reject(new Error("POP3 connection closed.")));
			};
			this.attachData();
			tryRead();
		});
	}
}

export async function createPop3Session(
	raw: MailboxCredentials,
): Promise<Pop3Session> {
	const credentials = normalizePop3Credentials(raw);
	const session = new Pop3Session(credentials);
	await session.connect();
	await session.login();
	return session;
}

export function normalizePop3Credentials(
	credentials: MailboxCredentials,
): MailboxCredentials {
	const base = normalizeMailboxCredentials({
		...credentials,
		accessProtocol: "pop3",
	});
	let port = base.port;
	let secure = base.secure;
	if (base.port === 993) {
		port = 995;
		secure = true;
	}
	if (!secure && port === 995) {
		secure = true;
	}
	if (secure && port === 110) {
		port = 995;
	}
	if (!secure && (port === 995 || port === 0 || Number.isNaN(port))) {
		port = 110;
	}
	return {
		...base,
		port,
		secure,
		accessProtocol: "pop3",
	};
}

export async function testPop3Connection(
	raw: MailboxCredentials,
): Promise<ConnectionTestResult> {
	const credentials = normalizePop3Credentials(raw);
	const validationError = validateMailboxCredentials(credentials);
	if (validationError) {
		return { success: false, error: validationError };
	}

	let session: Pop3Session | null = null;
	try {
		session = await createPop3Session(credentials);
		const stat = await session.stat();
		await session.quit();
		const folders: ImapFolder[] = [
			{
				path: POP3_INBOX_PATH,
				name: "Inbox",
				delimiter: "/",
				attributes: [],
				messageCount: stat.count,
			},
		];
		return { success: true, folders };
	} catch (error) {
		const message = formatImapError(error, credentials);
		return { success: false, error: message };
	} finally {
		session?.close();
	}
}

export async function measurePop3Mailbox(
	credentials: MailboxCredentials,
): Promise<FolderSizeEstimate[]> {
	const session = await createPop3Session(normalizePop3Credentials(credentials));
	try {
		const stat = await session.stat();
		return [
			{
				path: POP3_INBOX_PATH,
				messages: stat.count,
				bytes: stat.octets,
			},
		];
	} finally {
		try {
			await session.quit();
		} catch {
			session.close();
		}
	}
}

export async function fetchPop3FolderUids(
	session: Pop3Session,
	_folderPath: string,
): Promise<number[]> {
	const stat = await session.stat();
	const uidl = await session.uidl();
	const numbers: number[] = [];
	for (let n = 1; n <= stat.count; n++) {
		if (uidl.has(n)) numbers.push(n);
	}
	return numbers;
}

function extractMessageIdFromRfc822(source: Buffer): string | undefined {
	const head = source.subarray(0, Math.min(source.length, 32_768)).toString("utf8");
	const m = head.match(/^Message-ID:\s*<?([^>\r\n]+)>?/im);
	return m?.[1]?.trim();
}

export async function fetchPop3MessagesBatch(
	session: Pop3Session,
	_folderPath: string,
	messageNumbers: number[],
): Promise<FetchedMigrationMessage[]> {
	const uidl = await session.uidl();
	const out: FetchedMigrationMessage[] = [];
	for (const num of messageNumbers) {
		const source = await session.retr(num);
		out.push({
			uid: num,
			source,
			flags: new Set(),
			messageId: uidl.get(num) ?? extractMessageIdFromRfc822(source),
		});
	}
	return out;
}

export async function estimatePop3MigrationSize(
	source: MailboxCredentials,
	folderPaths: string[],
): Promise<{ totalBytes: number; messageCount: number; folders: FolderSizeEstimate[] }> {
	const session = await createPop3Session(normalizePop3Credentials(source));
	try {
		const stat = await session.stat();
		const folders: FolderSizeEstimate[] =
			folderPaths.length > 0
				? folderPaths.map((path) => ({
						path,
						messages: stat.count,
						bytes: stat.octets,
					}))
				: [
						{
							path: POP3_INBOX_PATH,
							messages: stat.count,
							bytes: stat.octets,
						},
					];
		return {
			totalBytes: stat.octets,
			messageCount: stat.count,
			folders,
		};
	} finally {
		try {
			await session.quit();
		} catch {
			session.close();
		}
	}
}
