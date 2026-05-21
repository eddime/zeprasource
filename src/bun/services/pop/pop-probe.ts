import type { MailboxCredentials } from "../../../shared/types";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import {
	createPop3Session,
	normalizePop3Credentials,
} from "./pop-client";

export type PopLoginProbeResult = "ok" | "auth-failed" | "network";

const CRLF = "\r\n";

function isAuthFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return /invalid|denied|failed|authentication|password|login/i.test(error.message);
}

/** POP3 greeting without login. */
export function probePop3Banner(
	host: string,
	port: number,
	secure: boolean,
	timeoutMs = 5_000,
): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		let buffer = "";
		let socket: ReturnType<typeof netConnect> | ReturnType<typeof tlsConnect> | null =
			null;

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
			if (buffer.includes(CRLF) && buffer.startsWith("+OK")) {
				finish(true);
			}
			if (buffer.length > 4_096) finish(false);
		};

		const onReady = () => {
			socket?.on("data", onData);
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

export async function probePop3Login(
	credentials: MailboxCredentials,
): Promise<PopLoginProbeResult> {
	const user = credentials.username?.trim() || credentials.email.trim();
	const pass = credentials.password ?? "";
	if (!user || !pass) return "network";

	let session = null;
	try {
		session = await createPop3Session(
			normalizePop3Credentials({ ...credentials, email: user, password: pass }),
		);
		await session.quit();
		return "ok";
	} catch (error) {
		if (isAuthFailure(error)) return "auth-failed";
		return "network";
	} finally {
		session?.close();
	}
}

const PROBE_BATCH = 6;

export async function pickVerifiedPopCandidate<
	T extends { host: string; port: number; secure: boolean },
>(
	candidates: T[],
	options: {
		email: string;
		password?: string;
		toCredentials: (c: T) => MailboxCredentials;
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
					const result = await probePop3Login({
						...creds,
						email,
						password: trimmedPassword,
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
				live: await probePop3Banner(
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
