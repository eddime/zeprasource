import { promises as dns } from "node:dns";
import { emailDomain } from "../../../shared/mailbox-provider";
import type { MailAccessProtocol } from "../../../shared/mail-access";
import type { ImapFolder, MailboxProvider } from "../../../shared/types";
import { createStreamingRace } from "./discovery-race";
import { probeImapBanner, probeImapLoginDetailed } from "./imap-probe";
import { probePop3Banner, probePop3Login } from "../pop/pop-probe";

export { detectProviderFromEmail } from "../../../shared/mailbox-provider";

/** Discovery — short timeouts; wrong hosts fail fast. */
const AUTOCONFIG_FETCH_MS = 1_500;
const DISCOVERY_BUDGET_MS = 12_000;
const DISCOVERY_PROBE_CONCURRENCY = 6;
const DISCOVERY_BANNER_PROBE_MS = 2_000;
/** In-memory prefetch (per app session, per domain) — no disk persistence. */
const PREFETCH_TTL_MS = 60_000;

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
	/** Present when discovery logged in successfully (skips a second connect). */
	folders?: ImapFolder[];
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

async function fetchAutoconfigXml(
	url: string,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const res = await fetch(url, {
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(AUTOCONFIG_FETCH_MS)])
				: AbortSignal.timeout(AUTOCONFIG_FETCH_MS),
			headers: { Accept: "application/xml,text/xml" },
		});
		if (!res.ok) return null;
		return await res.text();
	} catch {
		return null;
	}
}

/** Race autoconfig URLs (domain first, Thunderbird CDN last). */
async function raceImapAutoconfig(
	domain: string,
	abortSignal?: AbortSignal,
): Promise<{ host: string; port: number; secure: boolean; source: ImapDiscoverySource } | null> {
	const urls: Array<{ url: string; source: ImapDiscoverySource }> = [
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
		{
			url: `https://autoconfig.thunderbird.net/v1.1/${domain}`,
			source: "thunderbird",
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
			void fetchAutoconfigXml(url, abortSignal).then((xml) => {
				if (resolved || abortSignal?.aborted) return;
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
	abortSignal?: AbortSignal,
): Promise<{ host: string; port: number; secure: boolean; source: PopDiscoverySource } | null> {
	const urls: Array<{ url: string; source: PopDiscoverySource }> = [
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
		{
			url: `https://autoconfig.thunderbird.net/v1.1/${domain}`,
			source: "thunderbird",
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
			void fetchAutoconfigXml(url, abortSignal).then((xml) => {
				if (resolved || abortSignal?.aborted) return;
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
	const out: ImapDiscoveryCandidate[] = [];
	for (const { host, ok } of checks) {
		if (!ok) continue;
		const basePriority = host.startsWith("imap.") ? 40 : 45;
		// Many shared hosts use STARTTLS on 143 (993 may be closed).
		out.push(
			toImapCandidate(
				{ host, port: 143, secure: false, source: "guess" },
				basePriority - 2,
			),
			toImapCandidate(
				{ host, port: 993, secure: true, source: "guess" },
				basePriority,
			),
		);
	}
	return out;
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

function dedupeImapCandidates(candidates: ImapDiscoveryCandidate[]): ImapDiscoveryCandidate[] {
	const byKey = new Map<string, ImapDiscoveryCandidate>();
	for (const c of candidates) {
		const key = candidateKey(c);
		const existing = byKey.get(key);
		if (!existing || c.priority < existing.priority) {
			byKey.set(key, c);
		}
	}
	return [...byKey.values()];
}

function dedupePopCandidates(candidates: PopDiscoveryCandidate[]): PopDiscoveryCandidate[] {
	const byKey = new Map<string, PopDiscoveryCandidate>();
	for (const c of candidates) {
		const key = candidateKey(c);
		const existing = byKey.get(key);
		if (!existing || c.priority < existing.priority) {
			byKey.set(key, c);
		}
	}
	return [...byKey.values()];
}

type PrefetchCacheEntry = {
	imap: ImapDiscoveryCandidate[];
	pop: PopDiscoveryCandidate[];
	expiresAt: number;
};

const prefetchByDomain = new Map<string, PrefetchCacheEntry>();
const prefetchInFlight = new Map<string, Promise<void>>();

function getValidPrefetch(domain: string): PrefetchCacheEntry | null {
	const entry = prefetchByDomain.get(domain);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		prefetchByDomain.delete(domain);
		return null;
	}
	return entry;
}

/** Resolve SRV + autoconfig + DNS guesses without login (for prefetch). */
async function gatherImapCandidatesForPrefetch(
	domain: string,
	abortSignal?: AbortSignal,
): Promise<ImapDiscoveryCandidate[]> {
	const list: ImapDiscoveryCandidate[] = [];
	const [imaps, imap, autoconfig] = await Promise.all([
		resolveSrvCandidate(domain, `_imaps._tcp.${domain}`, 10),
		resolveSrvCandidate(domain, `_imap._tcp.${domain}`, 12),
		raceImapAutoconfig(domain, abortSignal),
	]);
	if (imaps) list.push(imaps);
	if (imap) list.push(imap);
	if (autoconfig) {
		list.push(
			toImapCandidate(autoconfig, autoconfig.source === "thunderbird" ? 15 : 18),
		);
	}
	await new Promise((r) => setTimeout(r, DNS_GUESS_DELAY_MS));
	if (!abortSignal?.aborted) {
		list.push(...(await imapCandidatesFromDnsGuesses(domain)));
	}
	return dedupeImapCandidates(list);
}

async function gatherPopCandidatesForPrefetch(
	domain: string,
	abortSignal?: AbortSignal,
): Promise<PopDiscoveryCandidate[]> {
	const list: PopDiscoveryCandidate[] = [];
	const autoconfig = await racePopAutoconfig(domain, abortSignal);
	if (autoconfig) {
		list.push(
			toPopCandidate(autoconfig, autoconfig.source === "thunderbird" ? 15 : 18),
		);
	}
	list.push(...(await popCandidatesFromDnsGuesses(domain)));
	return dedupePopCandidates(list);
}

async function runPrefetchJob(domain: string): Promise<void> {
	const abort = new AbortController();
	try {
		const [imap, pop] = await Promise.all([
			gatherImapCandidatesForPrefetch(domain, abort.signal),
			gatherPopCandidatesForPrefetch(domain, abort.signal),
		]);
		prefetchByDomain.set(domain, {
			imap,
			pop,
			expiresAt: Date.now() + PREFETCH_TTL_MS,
		});
	} finally {
		abort.abort();
	}
}

/**
 * Warm SRV/autoconfig/DNS for a domain while the user types their password.
 * Results live in memory only (cleared on app quit or after TTL).
 */
export function prefetchMailboxDiscovery(email: string): { started: boolean; domain?: string } {
	const trimmed = email.trim();
	const domain = emailDomain(trimmed);
	if (!domain || !trimmed.includes("@")) {
		return { started: false };
	}

	if (getValidPrefetch(domain)) {
		return { started: true, domain };
	}

	if (prefetchInFlight.has(domain)) {
		return { started: true, domain };
	}

	const job = runPrefetchJob(domain).finally(() => {
		prefetchInFlight.delete(domain);
	});
	prefetchInFlight.set(domain, job);
	return { started: true, domain };
}

function enqueuePrefetchedImap(
	domain: string,
	enqueue: (c: ImapDiscoveryCandidate) => void,
): void {
	for (const c of getValidPrefetch(domain)?.imap ?? []) {
		enqueue(c);
	}
	const inflight = prefetchInFlight.get(domain);
	if (inflight) {
		void inflight.then(() => {
			for (const c of getValidPrefetch(domain)?.imap ?? []) {
				enqueue(c);
			}
		});
	}
}

function enqueuePrefetchedPop(
	domain: string,
	enqueue: (c: PopDiscoveryCandidate) => void,
): void {
	for (const c of getValidPrefetch(domain)?.pop ?? []) {
		enqueue(c);
	}
	const inflight = prefetchInFlight.get(domain);
	if (inflight) {
		void inflight.then(() => {
			for (const c of getValidPrefetch(domain)?.pop ?? []) {
				enqueue(c);
			}
		});
	}
}

/** Push IMAP candidates into the race pool; calls onSourceDone once per parallel source. */
function streamImapCandidates(
	domain: string,
	enqueue: (c: ImapDiscoveryCandidate) => void,
	onSourceDone: () => void,
	abortSignal?: AbortSignal,
): void {
	const done = () => onSourceDone();

	enqueuePrefetchedImap(domain, enqueue);

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

	void raceImapAutoconfig(domain, abortSignal)
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
			if (abortSignal?.aborted) return;
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

	enqueuePrefetchedPop(domain, enqueue);

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

function imapResultFromCandidate(
	candidate: ImapDiscoveryCandidate,
	folders?: ImapFolder[],
): MailboxDiscoveryResult {
	const { priority: _p, ...result } = candidate;
	return { ...result, verified: true, accessProtocol: "imap", folders };
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
	collectFolders = false,
): Promise<{ candidate: ImapDiscoveryCandidate | null; folders?: ImapFolder[] }> {
	const trimmedPassword = password?.trim();
	const abort = new AbortController();
	let authenticated: {
		candidate: ImapDiscoveryCandidate;
		folders?: ImapFolder[];
	} | null = null;
	let authFailedCandidate: ImapDiscoveryCandidate | null = null;

	const race = createStreamingRace<ImapDiscoveryCandidate>({
		maxConcurrency: DISCOVERY_PROBE_CONCURRENCY,
		budgetMs: DISCOVERY_BUDGET_MS,
		candidateKey,
		probe: async (c) => {
			if (trimmedPassword) {
				const { result, folders } = await probeImapLoginDetailed(
					{
						provider: "generic",
						email,
						host: c.host,
						port: c.port,
						secure: c.secure,
						authMethod: "password",
						password: trimmedPassword,
						accessProtocol: "imap",
					},
					{ listFolders: collectFolders },
				);
				if (result === "ok") {
					authenticated = { candidate: c, folders };
				} else if (result === "auth-failed") {
					if (!authFailedCandidate || c.priority < authFailedCandidate.priority) {
						authFailedCandidate = c;
					}
				}
				return result;
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
	streamImapCandidates(domain, (c) => race.enqueue(c), onSourceDone, abort.signal);
	const bannerCandidate = await race.wait();
	abort.abort();

	if (trimmedPassword) {
		return {
			candidate: authenticated?.candidate ?? authFailedCandidate,
			folders: authenticated?.folders,
		};
	}
	return { candidate: bannerCandidate, folders: undefined };
}

async function raceVerifyPopCandidates(
	email: string,
	domain: string,
	password: string,
): Promise<PopDiscoveryCandidate | null> {
	const trimmedPassword = password.trim();
	let authenticated: PopDiscoveryCandidate | null = null;
	const race = createStreamingRace<PopDiscoveryCandidate>({
		maxConcurrency: DISCOVERY_PROBE_CONCURRENCY,
		budgetMs: DISCOVERY_BUDGET_MS,
		candidateKey,
		probe: async (c) => {
			const result = await probePop3Login({
				provider: "generic",
				email,
				host: c.host,
				port: c.port,
				secure: c.secure,
				authMethod: "password",
				password: trimmedPassword,
				accessProtocol: "pop3",
			});
			if (result === "ok") authenticated = c;
			return result;
		},
	});

	let pendingSources = 2;
	const onSourceDone = () => {
		pendingSources--;
		if (pendingSources === 0) race.close();
	};
	streamPopCandidates(domain, (c) => race.enqueue(c), onSourceDone);
	await race.wait();
	return authenticated;
}

/**
 * Discover mail settings via SRV, autoconfig (parallel), and DNS guesses —
 * proven with streaming login/banner race (no provider presets or caches).
 */
export async function discoverMailboxSettings(
	email: string,
	options?: { password?: string; collectFolders?: boolean; imapOnly?: boolean },
): Promise<MailboxDiscoveryResult> {
	const trimmed = email.trim();
	const domain = emailDomain(trimmed);
	if (!domain) {
		throw new Error("Enter a valid email address.");
	}

	const password = options?.password?.trim();
	const collectFolders = Boolean(options?.collectFolders && password);
	const imapOnly = options?.imapOnly !== false;

	const imapVerified = await raceVerifyImapCandidates(
		trimmed,
		domain,
		password,
		collectFolders,
	);
	if (imapVerified.candidate) {
		return imapResultFromCandidate(imapVerified.candidate, imapVerified.folders);
	}

	if (password && !imapOnly) {
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
