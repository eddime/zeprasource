import { promises as dns } from "node:dns";
import { emailDomain } from "../../../shared/mailbox-provider";
import type { MailAccessProtocol } from "../../../shared/mail-access";
import type { MailboxProvider } from "../../../shared/types";
import { createStreamingRace } from "./discovery-race";
import { probeImapBanner, probeImapLogin } from "./imap-probe";
import { probePop3Banner, probePop3Login } from "../pop/pop-probe";

export { detectProviderFromEmail } from "../../../shared/mailbox-provider";

/** Discovery — short timeouts; wrong hosts fail fast. */
const AUTOCONFIG_FETCH_MS = 2_000;
const DISCOVERY_BUDGET_MS = 10_000;
const DISCOVERY_PROBE_CONCURRENCY = 5;
const DISCOVERY_BANNER_PROBE_MS = 2_500;

export type ImapDiscoverySource =
	| "thunderbird"
	| "autoconfig"
	| "srv"
	| "guess";

export interface ImapDiscoveryResult {
	host: string;
	port: number;
	secure: boolean;
	provider: MailboxProvider;
	source: ImapDiscoverySource;
	verified: boolean;
}

export interface MailboxDiscoveryResult extends ImapDiscoveryResult {
	accessProtocol: MailAccessProtocol;
}

interface ImapDiscoveryCandidate extends ImapDiscoveryResult {
	priority: number;
}

type PopDiscoverySource = ImapDiscoverySource;

interface PopDiscoveryCandidate {
	host: string;
	port: number;
	secure: boolean;
	provider: MailboxProvider;
	source: PopDiscoverySource;
	verified: boolean;
	priority: number;
}

function toImapCandidate(
	partial: Omit<ImapDiscoveryResult, "provider" | "verified">,
	priority: number,
): ImapDiscoveryCandidate {
	return {
		...partial,
		provider: "generic",
		verified: false,
		priority,
	};
}

function toPopCandidate(
	partial: Omit<PopDiscoveryCandidate, "provider" | "verified" | "priority">,
	priority: number,
): PopDiscoveryCandidate {
	return {
		...partial,
		provider: "generic",
		verified: false,
		priority,
	};
}

async function hostResolves(host: string): Promise<boolean> {
	try {
		await dns.lookup(host);
		return true;
	} catch {
		return false;
	}
}

function parseIncomingServerBlock(
	xml: string,
	type: "imap" | "pop3",
	source: ImapDiscoverySource,
): { host: string; port: number; secure: boolean; source: ImapDiscoverySource } | null {
	const blockMatch = xml.match(
		new RegExp(
			`<incomingServer[^>]*type\\s*=\\s*["']${type}["'][^>]*>([\\s\\S]*?)<\\/incomingServer>`,
			"i",
		),
	);
	if (!blockMatch) return null;

	const block = blockMatch[1];
	const host = block.match(/<hostname>([^<]+)<\/hostname>/i)?.[1]?.trim();
	if (!host) return null;

	const defaultPort = type === "imap" ? 993 : 995;
	const port = Number.parseInt(
		block.match(/<port>([^<]+)<\/port>/i)?.[1] ?? String(defaultPort),
		10,
	);
	const socket = block.match(/<socketType>([^<]+)<\/socketType>/i)?.[1]?.trim().toUpperCase();
	const sslDefault = type === "imap" ? 993 : 995;
	const plainDefault = type === "imap" ? 143 : 110;
	const secure =
		socket === "SSL" ||
		(socket !== "STARTTLS" && socket !== "PLAIN" && port === sslDefault);

	return {
		host,
		port:
			Number.isFinite(port) && port > 0
				? port
				: secure
					? sslDefault
					: plainDefault,
		secure: secure && port !== plainDefault,
		source,
	};
}

async function fetchAutoconfigXml(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(AUTOCONFIG_FETCH_MS),
			headers: { Accept: "application/xml,text/xml" },
		});
		if (!res.ok) return null;
		return await res.text();
	} catch {
		return null;
	}
}

/** Race all autoconfig URLs; first valid IMAP block wins. */
async function raceImapAutoconfig(
	domain: string,
): Promise<{ host: string; port: number; secure: boolean; source: ImapDiscoverySource } | null> {
	const urls: Array<{ url: string; source: ImapDiscoverySource }> = [
		{
			url: `https://autoconfig.thunderbird.net/v1.1/${domain}`,
			source: "thunderbird",
		},
		{
			url: `https://autoconfig.${domain}/mail/config-v1.1.xml`,
			source: "autoconfig",
		},
		{
			url: `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
			source: "autoconfig",
		},
		{
			url: `https://mail.${domain}/mail/config-v1.1.xml`,
			source: "autoconfig",
		},
	];

	return new Promise((resolve) => {
		let pending = urls.length;
		let resolved = false;

		const finish = (value: typeof resolve extends (v: infer V) => void ? V : never) => {
			if (resolved) return;
			resolved = true;
			resolve(value);
		};

		for (const { url, source } of urls) {
			void fetchAutoconfigXml(url).then((xml) => {
				if (resolved) return;
				if (xml) {
					const parsed = parseIncomingServerBlock(xml, "imap", source);
					if (parsed) {
						finish(parsed);
						return;
					}
				}
				pending--;
				if (pending === 0) finish(null);
			});
		}
	});
}

async function racePopAutoconfig(
	domain: string,
): Promise<{ host: string; port: number; secure: boolean; source: PopDiscoverySource } | null> {
	const urls: Array<{ url: string; source: PopDiscoverySource }> = [
		{
			url: `https://autoconfig.thunderbird.net/v1.1/${domain}`,
			source: "thunderbird",
		},
		{
			url: `https://autoconfig.${domain}/mail/config-v1.1.xml`,
			source: "autoconfig",
		},
		{
			url: `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
			source: "autoconfig",
		},
		{
			url: `https://mail.${domain}/mail/config-v1.1.xml`,
			source: "autoconfig",
		},
	];

	return new Promise((resolve) => {
		let pending = urls.length;
		let resolved = false;

		const finish = (value: typeof resolve extends (v: infer V) => void ? V : never) => {
			if (resolved) return;
			resolved = true;
			resolve(value);
		};

		for (const { url, source } of urls) {
			void fetchAutoconfigXml(url).then((xml) => {
				if (resolved) return;
				if (xml) {
					const parsed = parseIncomingServerBlock(xml, "pop3", source);
					if (parsed) {
						finish(parsed);
						return;
					}
				}
				pending--;
				if (pending === 0) finish(null);
			});
		}
	});
}

async function resolveSrvCandidate(
	domain: string,
	name: string,
	priority: number,
): Promise<ImapDiscoveryCandidate | null> {
	try {
		const records = await dns.resolveSrv(name);
		const sorted = [...records].sort(
			(a, b) => a.priority - b.priority || b.weight - a.weight,
		);
		const best = sorted[0];
		if (!best?.name) return null;
		const secure = name.startsWith("_imaps");
		return toImapCandidate(
			{
				host: best.name.replace(/\.$/, ""),
				port: best.port || (secure ? 993 : 143),
				secure,
				source: "srv",
			},
			priority,
		);
	} catch {
		return null;
	}
}

async function imapCandidatesFromDnsGuesses(domain: string): Promise<ImapDiscoveryCandidate[]> {
	const hosts = [`imap.${domain}`, `mail.${domain}`] as const;
	const checks = await Promise.all(
		hosts.map(async (host) => ({ host, ok: await hostResolves(host) })),
	);
	return checks
		.filter((c) => c.ok)
		.map(({ host }) =>
			toImapCandidate(
				{
					host,
					port: 993,
					secure: true,
					source: "guess",
				},
				host.startsWith("imap.") ? 40 : 45,
			),
		);
}

async function popCandidatesFromDnsGuesses(domain: string): Promise<PopDiscoveryCandidate[]> {
	const hosts = [`pop.${domain}`, `pop3.${domain}`, `mail.${domain}`] as const;
	const checks = await Promise.all(
		hosts.map(async (host) => ({ host, ok: await hostResolves(host) })),
	);
	return checks
		.filter((c) => c.ok)
		.map(({ host }) =>
			toPopCandidate(
				{
					host,
					port: host.startsWith("pop") ? 995 : 110,
					secure: host.startsWith("pop"),
					source: "guess",
				},
				host.startsWith("pop3.") ? 42 : host.startsWith("pop.") ? 40 : 48,
			),
		);
}

function candidateKey(c: { host: string; port: number; secure: boolean }): string {
	return `${c.host}:${c.port}:${c.secure}`;
}

/** Push IMAP candidates into the race pool; calls onSourceDone once per parallel source. */
function streamImapCandidates(
	domain: string,
	enqueue: (c: ImapDiscoveryCandidate) => void,
	onSourceDone: () => void,
): void {
	const done = () => onSourceDone();

	void resolveSrvCandidate(domain, `_imaps._tcp.${domain}`, 10)
		.then((c) => {
			if (c) enqueue(c);
		})
		.finally(done);

	void resolveSrvCandidate(domain, `_imap._tcp.${domain}`, 12)
		.then((c) => {
			if (c) enqueue(c);
		})
		.finally(done);

	void raceImapAutoconfig(domain)
		.then((parsed) => {
			if (parsed) {
				enqueue(
					toImapCandidate(parsed, parsed.source === "thunderbird" ? 15 : 18),
				);
			}
		})
		.finally(done);

	void imapCandidatesFromDnsGuesses(domain)
		.then((list) => {
			for (const c of list) enqueue(c);
		})
		.finally(done);
}

function streamPopCandidates(
	domain: string,
	enqueue: (c: PopDiscoveryCandidate) => void,
	onSourceDone: () => void,
): void {
	const done = () => onSourceDone();

	void racePopAutoconfig(domain)
		.then((parsed) => {
			if (parsed) {
				enqueue(
					toPopCandidate(parsed, parsed.source === "thunderbird" ? 15 : 18),
				);
			}
		})
		.finally(done);

	void popCandidatesFromDnsGuesses(domain)
		.then((list) => {
			for (const c of list) enqueue(c);
		})
		.finally(done);
}

function imapResultFromCandidate(candidate: ImapDiscoveryCandidate): MailboxDiscoveryResult {
	const { priority: _p, ...result } = candidate;
	return { ...result, verified: true, accessProtocol: "imap" };
}

function popResultFromCandidate(candidate: PopDiscoveryCandidate): MailboxDiscoveryResult {
	const { priority: _p, ...rest } = candidate;
	return {
		...rest,
		verified: true,
		accessProtocol: "pop3",
	};
}

async function raceVerifyImapCandidates(
	email: string,
	domain: string,
	password?: string,
): Promise<ImapDiscoveryCandidate | null> {
	const trimmedPassword = password?.trim();
	const race = createStreamingRace<ImapDiscoveryCandidate>({
		maxConcurrency: DISCOVERY_PROBE_CONCURRENCY,
		budgetMs: DISCOVERY_BUDGET_MS,
		candidateKey,
		probe: async (c) => {
			if (trimmedPassword) {
				return probeImapLogin({
					provider: "generic",
					email,
					host: c.host,
					port: c.port,
					secure: c.secure,
					authMethod: "password",
					password: trimmedPassword,
					accessProtocol: "imap",
				});
			}
			const live = await probeImapBanner(
				c.host,
				c.port,
				c.secure,
				DISCOVERY_BANNER_PROBE_MS,
			);
			return live ? "ok" : "network";
		},
	});

	let pendingSources = 4;
	const onSourceDone = () => {
		pendingSources--;
		if (pendingSources === 0) race.close();
	};
	streamImapCandidates(domain, (c) => race.enqueue(c), onSourceDone);
	return race.wait();
}

async function raceVerifyPopCandidates(
	email: string,
	domain: string,
	password: string,
): Promise<PopDiscoveryCandidate | null> {
	const trimmedPassword = password.trim();
	const race = createStreamingRace<PopDiscoveryCandidate>({
		maxConcurrency: DISCOVERY_PROBE_CONCURRENCY,
		budgetMs: DISCOVERY_BUDGET_MS,
		candidateKey,
		probe: async (c) =>
			probePop3Login({
				provider: "generic",
				email,
				host: c.host,
				port: c.port,
				secure: c.secure,
				authMethod: "password",
				password: trimmedPassword,
				accessProtocol: "pop3",
			}),
	});

	let pendingSources = 2;
	const onSourceDone = () => {
		pendingSources--;
		if (pendingSources === 0) race.close();
	};
	streamPopCandidates(domain, (c) => race.enqueue(c), onSourceDone);
	return race.wait();
}

/**
 * Discover mail settings via SRV, autoconfig (parallel), and DNS guesses —
 * proven with streaming login/banner race (no provider presets or caches).
 */
export async function discoverMailboxSettings(
	email: string,
	options?: { password?: string },
): Promise<MailboxDiscoveryResult> {
	const trimmed = email.trim();
	const domain = emailDomain(trimmed);
	if (!domain) {
		throw new Error("Enter a valid email address.");
	}

	const password = options?.password?.trim();

	const imapVerified = await raceVerifyImapCandidates(trimmed, domain, password);
	if (imapVerified) {
		return imapResultFromCandidate(imapVerified);
	}

	if (password) {
		const popVerified = await raceVerifyPopCandidates(trimmed, domain, password);
		if (popVerified) {
			return popResultFromCandidate(popVerified);
		}
	}

	throw new Error(
		password
			? `No working mail server found for ${domain}. Check your password or enter the server manually under “Show server settings”.`
			: `Could not verify a mail server for ${domain}. Enter your password and try again, or set the server manually.`,
	);
}

export async function discoverImapSettings(
	email: string,
	options?: { password?: string },
): Promise<MailboxDiscoveryResult> {
	return discoverMailboxSettings(email, options);
}
