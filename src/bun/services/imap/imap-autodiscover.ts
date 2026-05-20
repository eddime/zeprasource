import { promises as dns } from "node:dns";
import { connect as tlsConnect } from "node:tls";
import {
	detectProviderFromEmail,
	emailDomain,
} from "../../../shared/mailbox-provider";
import type { MailboxProvider } from "../../../shared/types";
import { PROVIDER_PRESETS } from "../../../shared/types";
import { resolveOutlookHost } from "./credentials";

export { detectProviderFromEmail } from "../../../shared/mailbox-provider";
import { pickVerifiedCandidate } from "./imap-probe";

/** Discovery fetches — kept short; wrong hosts fail fast in parallel probes. */
const AUTOCONFIG_FETCH_MS = 4_000;
const TLS_CERT_PROBE_MS = 4_000;
const DISCOVERY_BANNER_PROBE_MS = 3_500;

export type ImapDiscoverySource =
	| "preset"
	| "thunderbird"
	| "autoconfig"
	| "srv"
	| "mx"
	| "hosting"
	| "guess";

export interface ImapDiscoveryResult {
	host: string;
	port: number;
	secure: boolean;
	provider: MailboxProvider;
	source: ImapDiscoverySource;
	verified: boolean;
}

interface ImapDiscoveryCandidate extends ImapDiscoveryResult {
	priority: number;
}

/** Shared-hosting IMAP when the domain has mail. but no imap. subdomain. */
const SHARED_HOSTING_IMAP: Array<{
	id: string;
	host: string;
	port: number;
	secure: boolean;
	certMatch: RegExp;
}> = [
	{
		id: "dreamhost",
		host: "imap.dreamhost.com",
		port: 993,
		secure: true,
		certMatch: /dreamhost\.com/i,
	},
	{
		id: "ionos",
		host: "imap.ionos.de",
		port: 993,
		secure: true,
		certMatch: /ionos|1and1/i,
	},
	{
		id: "strato",
		host: "imap.strato.de",
		port: 993,
		secure: true,
		certMatch: /strato/i,
	},
	{
		id: "hostinger",
		host: "imap.hostinger.com",
		port: 993,
		secure: true,
		certMatch: /hostinger/i,
	},
	{
		id: "one",
		host: "imap.one.com",
		port: 993,
		secure: true,
		certMatch: /one\.com/i,
	},
];

/** MX host patterns → likely IMAP endpoints (multiple per provider allowed). */
const MX_IMAP_HINTS: Array<{
	pattern: RegExp;
	candidates: Array<Omit<ImapDiscoveryResult, "provider" | "verified"> & { provider?: MailboxProvider }>;
}> = [
	{
		pattern: /google|gmail|googlemail/i,
		candidates: [{ host: "imap.gmail.com", port: 993, secure: true, source: "mx", provider: "gmail" }],
	},
	{
		pattern: /outlook|hotmail|protection\.outlook|office365/i,
		candidates: [
			{
				host: "outlook.office365.com",
				port: 993,
				secure: true,
				source: "mx",
				provider: "outlook",
			},
			{
				host: "imap-mail.outlook.com",
				port: 993,
				secure: true,
				source: "mx",
				provider: "outlook",
			},
		],
	},
	{
		pattern: /dreamhost/i,
		candidates: [
			{ host: "imap.dreamhost.com", port: 993, secure: true, source: "mx" },
		],
	},
	{
		pattern: /zoho/i,
		candidates: [
			{ host: "imap.zoho.eu", port: 993, secure: true, source: "mx" },
			{ host: "imap.zoho.com", port: 993, secure: true, source: "mx" },
		],
	},
	{
		pattern: /yandex/i,
		candidates: [{ host: "imap.yandex.com", port: 993, secure: true, source: "mx" }],
	},
	{
		pattern: /messagingengine|fastmail/i,
		candidates: [{ host: "imap.fastmail.com", port: 993, secure: true, source: "mx" }],
	},
];

function presetForProvider(provider: MailboxProvider, email: string): ImapDiscoveryResult {
	const preset = PROVIDER_PRESETS[provider];
	let host = preset.host;
	if (provider === "outlook" && email) {
		host = resolveOutlookHost(email);
	}
	return {
		host,
		port: preset.port,
		secure: preset.secure,
		provider,
		source: "preset",
		verified: true,
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

async function readMailSubdomainCert(domain: string): Promise<string | null> {
	const mailHost = `mail.${domain}`;
	if (!(await hostResolves(mailHost))) return null;

	return new Promise((resolve) => {
		const socket = tlsConnect(
			993,
			mailHost,
			{ servername: mailHost, rejectUnauthorized: false },
			() => {
				try {
					const cert = socket.getPeerCertificate();
					const parts = [
						cert.subjectaltname ?? "",
						cert.subject?.CN ?? "",
						cert.issuer?.O ?? "",
					].join(" ");
					socket.end();
					resolve(parts);
				} catch {
					socket.destroy();
					resolve(null);
				}
			},
		);
		socket.setTimeout(TLS_CERT_PROBE_MS, () => {
			socket.destroy();
			resolve(null);
		});
		socket.on("error", () => resolve(null));
	});
}

function parseMozillaAutoconfig(
	xml: string,
	source: ImapDiscoverySource,
): Omit<ImapDiscoveryResult, "provider" | "verified"> | null {
	const imapBlock = xml.match(
		/<incomingServer[^>]*type\s*=\s*["']imap["'][^>]*>([\s\S]*?)<\/incomingServer>/i,
	);
	if (!imapBlock) return null;

	const block = imapBlock[1];
	const host = block.match(/<hostname>([^<]+)<\/hostname>/i)?.[1]?.trim();
	if (!host) return null;

	const port = Number.parseInt(block.match(/<port>([^<]+)<\/port>/i)?.[1] ?? "993", 10);
	const socket = block.match(/<socketType>([^<]+)<\/socketType>/i)?.[1]?.trim().toUpperCase();
	const secure = socket !== "STARTTLS" && socket !== "PLAIN" && port !== 143;

	return {
		host,
		port: Number.isFinite(port) && port > 0 ? port : secure ? 993 : 143,
		secure: secure && port !== 143,
		source,
	};
}

async function fetchThunderbirdAutoconfig(
	domain: string,
): Promise<Omit<ImapDiscoveryResult, "provider" | "verified"> | null> {
	try {
		const res = await fetch(`https://autoconfig.thunderbird.net/v1.1/${domain}`, {
			signal: AbortSignal.timeout(AUTOCONFIG_FETCH_MS),
			headers: { Accept: "application/xml,text/xml" },
		});
		if (!res.ok) return null;
		const xml = await res.text();
		return parseMozillaAutoconfig(xml, "thunderbird");
	} catch {
		return null;
	}
}

async function fetchDomainAutoconfig(
	domain: string,
): Promise<Omit<ImapDiscoveryResult, "provider" | "verified"> | null> {
	const urls = [
		`https://autoconfig.${domain}/mail/config-v1.1.xml`,
		`https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
		`https://mail.${domain}/mail/config-v1.1.xml`,
	];

	const fetches = await Promise.all(
		urls.map(async (url) => {
			try {
				const res = await fetch(url, {
					signal: AbortSignal.timeout(AUTOCONFIG_FETCH_MS),
					headers: { Accept: "application/xml,text/xml" },
				});
				if (!res.ok) return null;
				const xml = await res.text();
				return parseMozillaAutoconfig(xml, "autoconfig");
			} catch {
				return null;
			}
		}),
	);
	return fetches.find((parsed) => parsed !== null) ?? null;
}

async function resolveMxHosts(domain: string): Promise<string[]> {
	try {
		const records = await dns.resolveMx(domain);
		return records
			.sort((a, b) => a.priority - b.priority)
			.map((r) => r.exchange.replace(/\.$/, "").toLowerCase());
	} catch {
		return [];
	}
}

function usesMailchannels(mxHosts: string[]): boolean {
	return mxHosts.some((h) => /mailchannels/i.test(h));
}

async function candidatesFromMx(
	domain: string,
	email: string,
): Promise<ImapDiscoveryCandidate[]> {
	const mxHosts = await resolveMxHosts(domain);
	const out: ImapDiscoveryCandidate[] = [];
	const mxBlob = mxHosts.join(" ");

	for (const hint of MX_IMAP_HINTS) {
		if (!hint.pattern.test(mxBlob)) continue;
		for (const c of hint.candidates) {
			let host = c.host;
			if (c.provider === "outlook" && email) {
				host = resolveOutlookHost(email);
			}
			out.push({
				host,
				port: c.port,
				secure: c.secure,
				provider: c.provider ?? "generic",
				source: "mx",
				verified: false,
				priority: 25,
			});
		}
	}

	if (usesMailchannels(mxHosts)) {
		const hostingChecks = await Promise.all(
			SHARED_HOSTING_IMAP.map(async (hosting) => ({
				hosting,
				resolves: await hostResolves(hosting.host),
			})),
		);
		for (const { hosting, resolves } of hostingChecks) {
			if (!resolves) continue;
			out.push({
				host: hosting.host,
				port: hosting.port,
				secure: hosting.secure,
				provider: "generic",
				source: "mx",
				verified: false,
				priority: 32,
			});
		}
	}

	return out;
}

async function candidatesFromSharedHosting(
	domain: string,
): Promise<ImapDiscoveryCandidate[]> {
	const imapSub = `imap.${domain}`;
	const mailSub = `mail.${domain}`;
	const [imapExists, mailExists] = await Promise.all([
		hostResolves(imapSub),
		hostResolves(mailSub),
	]);
	if (imapExists || !mailExists) return [];

	const out: ImapDiscoveryCandidate[] = [];
	const certText = await readMailSubdomainCert(domain);

	if (certText) {
		const hostingResolvable = await Promise.all(
			SHARED_HOSTING_IMAP.map(async (hosting) => ({
				hosting,
				resolves: await hostResolves(hosting.host),
			})),
		);
		for (const { hosting, resolves } of hostingResolvable) {
			if (!resolves || !hosting.certMatch.test(certText)) continue;
			out.push({
				host: hosting.host,
				port: hosting.port,
				secure: hosting.secure,
				provider: "generic",
				source: "hosting",
				verified: false,
				priority: 20,
			});
		}
	}

	return out;
}

async function resolveSrvCandidate(
	domain: string,
	name: string,
): Promise<ImapDiscoveryCandidate | null> {
	try {
		const records = await dns.resolveSrv(name);
		const sorted = [...records].sort(
			(a, b) => a.priority - b.priority || b.weight - a.weight,
		);
		const best = sorted[0];
		if (!best?.name) return null;
		const secure = name.startsWith("_imaps");
		return {
			host: best.name.replace(/\.$/, ""),
			port: best.port || (secure ? 993 : 143),
			secure,
			provider: "generic",
			source: "srv",
			verified: false,
			priority: 15,
		};
	} catch {
		return null;
	}
}

async function candidatesFromSrv(domain: string): Promise<ImapDiscoveryCandidate[]> {
	const results = await Promise.all([
		resolveSrvCandidate(domain, `_imaps._tcp.${domain}`),
		resolveSrvCandidate(domain, `_imap._tcp.${domain}`),
	]);
	return results.filter((c): c is ImapDiscoveryCandidate => c !== null);
}

async function candidatesFromDnsGuesses(domain: string): Promise<ImapDiscoveryCandidate[]> {
	const hosts = [`imap.${domain}`, `mail.${domain}`] as const;
	const checks = await Promise.all(
		hosts.map(async (host) => ({ host, ok: await hostResolves(host) })),
	);
	return checks
		.filter((c) => c.ok)
		.map(({ host }) => ({
			host,
			port: 993,
			secure: true,
			provider: "generic" as const,
			source: "guess" as const,
			verified: false,
			priority: host.startsWith("imap.") ? 40 : 45,
		}));
}

function dedupeCandidates(candidates: ImapDiscoveryCandidate[]): ImapDiscoveryCandidate[] {
	const byKey = new Map<string, ImapDiscoveryCandidate>();
	for (const c of candidates) {
		const key = `${c.host}:${c.port}:${c.secure}`;
		const existing = byKey.get(key);
		if (!existing || c.priority < existing.priority) {
			byKey.set(key, c);
		}
	}
	return [...byKey.values()].sort((a, b) => a.priority - b.priority);
}

async function collectImapCandidates(
	email: string,
	domain: string,
): Promise<ImapDiscoveryCandidate[]> {
	const trimmed = email.trim();
	const list: ImapDiscoveryCandidate[] = [];

	const known = detectProviderFromEmail(trimmed);
	if (known) {
		const preset = presetForProvider(known, trimmed);
		list.push({ ...preset, verified: false, priority: 0 });
	}

	const [thunderbird, autoconfig, srv, mx, hosting, guesses] = await Promise.all([
		fetchThunderbirdAutoconfig(domain),
		fetchDomainAutoconfig(domain),
		candidatesFromSrv(domain),
		candidatesFromMx(domain, trimmed),
		candidatesFromSharedHosting(domain),
		candidatesFromDnsGuesses(domain),
	]);

	if (thunderbird) {
		list.push({
			...thunderbird,
			provider: known ?? "generic",
			verified: false,
			priority: 5,
		});
	}

	if (autoconfig) {
		list.push({
			...autoconfig,
			provider: known ?? "generic",
			verified: false,
			priority: 8,
		});
	}

	list.push(...srv, ...mx, ...hosting, ...guesses);

	return dedupeCandidates(list);
}

/**
 * Discover IMAP settings by gathering candidates from DNS, MX, Mozilla autoconfig,
 * and hosting signals — then **proving** the server speaks IMAP (banner or login).
 */
export async function discoverImapSettings(
	email: string,
	options?: { password?: string },
): Promise<ImapDiscoveryResult> {
	const trimmed = email.trim();
	const domain = emailDomain(trimmed);
	if (!domain) {
		throw new Error("Enter a valid email address.");
	}

	const known = detectProviderFromEmail(trimmed);
	const password = options?.password?.trim();

	if (known && !password) {
		return presetForProvider(known, trimmed);
	}

	if (known && password) {
		const preset = presetForProvider(known, trimmed);
		const presetCandidate: ImapDiscoveryCandidate = {
			...preset,
			verified: false,
			priority: 0,
		};
		const presetVerified = await pickVerifiedCandidate([presetCandidate], {
			email: trimmed,
			password,
			bannerTimeoutMs: DISCOVERY_BANNER_PROBE_MS,
			toCredentials: (c) => ({
				provider: c.provider,
				email: trimmed,
				host: c.host,
				port: c.port,
				secure: c.secure,
				authMethod: "password",
				password,
			}),
		});
		if (presetVerified) {
			const { priority: _p, ...result } = presetVerified;
			return { ...result, verified: true };
		}
	}

	const candidates = await collectImapCandidates(trimmed, domain);
	if (candidates.length === 0) {
		throw new Error(
			`Could not find an IMAP server for ${domain}. Open “Show server settings” and enter the host from your email provider.`,
		);
	}

	const verified = await pickVerifiedCandidate(candidates, {
		email: trimmed,
		password,
		bannerTimeoutMs: DISCOVERY_BANNER_PROBE_MS,
		toCredentials: (c) => ({
			provider: c.provider,
			email: trimmed,
			host: c.host,
			port: c.port,
			secure: c.secure,
			authMethod: "password",
			password,
		}),
	});

	if (verified) {
		const { priority: _p, ...result } = verified;
		return { ...result, verified: true };
	}

	throw new Error(
		password
			? `No working IMAP server found for ${domain}. Check your password or enter the server manually under “Show server settings”.`
			: `Could not verify an IMAP server for ${domain}. Enter your password and try again, or set the server manually.`,
	);
}
