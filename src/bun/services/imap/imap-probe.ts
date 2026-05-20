import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import type { MailboxCredentials } from "../../../shared/types";
import { createImapClient, safeCloseImapClient } from "./imap-client";

export type ImapLoginProbeResult = "ok" | "auth-failed" | "network";

const IMAP_GREETING = /^\* .+(IMAP|OK|PREAUTH)/im;
const IMAP_CAPABILITY = /\* CAPABILITY/i;

/** TLS/plain connect + CAPABILITY — confirms an IMAP server is listening (no login). */
export function probeImapBanner(
	host: string,
	port: number,
	secure: boolean,
	timeoutMs = 5_000,
): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		let buffer = "";
		let socket: ReturnType<typeof netConnect> | ReturnType<typeof tlsConnect> | null = null;

		const finish = (ok: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				socket?.destroy();
			} catch {
				/* closed */
			}
			resolve(ok);
		};

		const timer = setTimeout(() => finish(false), timeoutMs);

		const onData = (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (IMAP_GREETING.test(buffer) || IMAP_CAPABILITY.test(buffer)) {
				finish(true);
			}
			if (buffer.length > 8_192) finish(false);
		};

		const onReady = () => {
			socket?.on("data", onData);
			socket?.write("a001 CAPABILITY\r\n");
		};

		try {
			if (secure) {
				socket = tlsConnect(
					{
						host,
						port,
						servername: host,
						rejectUnauthorized: true,
						minVersion: "TLSv1.2",
					},
					onReady,
				);
			} else {
				socket = netConnect({ host, port }, onReady);
			}
			socket.on("error", () => finish(false));
		} catch {
			finish(false);
		}
	});
}

function isAuthFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const err = error as Error & {
		authenticationFailed?: boolean;
		responseText?: string;
	};
	if (err.authenticationFailed) return true;
	const text = `${err.responseText ?? ""} ${err.message}`;
	return /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|NO \[AUTHENTICATIONFAILED\]/i.test(
		text,
	);
}

/** Login probe — auth failure still means we found the right server. */
export async function probeImapLogin(
	credentials: MailboxCredentials,
): Promise<ImapLoginProbeResult> {
	const user = credentials.username?.trim() || credentials.email.trim();
	const pass = credentials.password ?? "";
	if (!user || !pass) return "network";

	const client = await createImapClient(
		{ ...credentials, email: user, password: pass, authMethod: "password" },
		"probe",
	);

	try {
		await client.connect();
		await client.logout();
		return "ok";
	} catch (error) {
		if (isAuthFailure(error)) return "auth-failed";
		return "network";
	} finally {
		await safeCloseImapClient(client);
	}
}

const PROBE_BATCH = 6;

export async function pickVerifiedCandidate<T extends { host: string; port: number; secure: boolean }>(
	candidates: T[],
	options: {
		email: string;
		password?: string;
		toCredentials: (c: T) => MailboxCredentials;
		/** Shorter timeout during autodiscovery (many hosts may be probed). */
		bannerTimeoutMs?: number;
	},
): Promise<T | null> {
	const { email, password, toCredentials, bannerTimeoutMs = 5_000 } = options;
	const trimmedPassword = password?.trim();

	if (trimmedPassword) {
		for (let i = 0; i < candidates.length; i += PROBE_BATCH) {
			const batch = candidates.slice(i, i + PROBE_BATCH);
			const probes = await Promise.all(
				batch.map(async (candidate) => {
					const creds = toCredentials(candidate);
					const result = await probeImapLogin({
						...creds,
						email,
						password: trimmedPassword,
						authMethod: "password",
					});
					return { candidate, result };
				}),
			);

			const authenticated = probes.find((p) => p.result === "ok");
			if (authenticated) return authenticated.candidate;

			const authFailed = probes.find((p) => p.result === "auth-failed");
			if (authFailed) return authFailed.candidate;
		}
		return null;
	}

	for (let i = 0; i < candidates.length; i += PROBE_BATCH) {
		const batch = candidates.slice(i, i + PROBE_BATCH);
		const probes = await Promise.all(
			batch.map(async (candidate) => ({
				candidate,
				live: await probeImapBanner(
					candidate.host,
					candidate.port,
					candidate.secure,
					bannerTimeoutMs,
				),
			})),
		);
		const hit = probes.find((p) => p.live);
		if (hit) return hit.candidate;
	}

	return null;
}
