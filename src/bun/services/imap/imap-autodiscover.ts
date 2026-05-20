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
		socket.setTimeout(6_000, () => {
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
			signal: AbortSignal.timeout(8_000),
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

	for (const url of urls) {
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(8_000),
				headers: { Accept: "application/xml,text/xml" },
			});
			if (!res.ok) continue;
			const xml = await res.text();
			const parsed = parseMozillaAutoconfig(xml, "autoconfig");
			if (parsed) return parsed;
		} catch {
			/* try next URL */
		}
	}
	return null;
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
		for (const hosting of SHARED_HOSTING_IMAP) {
			if (await hostResolves(hosting.host)) {
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
	}

	return out;
}

async function candidatesFromSharedHosting(
	domain: string,
): Promise<ImapDiscoveryCandidate[]> {
	const imapSub = `imap.${domain}`;
	const mailSub = `mail.${domain}`;
	const imapExists = await hostResolves(imapSub);
	const mailExists = await hostResolves(mailSub);
	if (imapExists || !mailExists) return [];

	const out: ImapDiscoveryCandidate[] = [];
	const certText = await readMailSubdomainCert(domain);

	if (certText) {
		for (const hosting of SHARED_HOSTING_IMAP) {
			if (!hosting.certMatch.test(certText)) continue;
			if (!(await hostResolves(hosting.host))) continue;
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

async function candidatesFromSrv(domain: string): Promise<ImapDiscoveryCandidate[]> {
	const out: ImapDiscoveryCandidate[] = [];
	for (const name of [`_imaps._tcp.${domain}`, `_imap._tcp.${domain}`]) {
		try {
			const records = await dns.resolveSrv(name);
			const sorted = [...records].sort(
				(a, b) => a.priority - b.priority || b.weight - a.weight,
			);
			const best = sorted[0];
			if (!best?.name) continue;
			const secure = name.startsWith("_imaps");
			out.push({
				host: best.name.replace(/\.$/, ""),
				port: best.port || (secure ? 993 : 143),
				secure,
				provider: "generic",
				source: "srv",
				verified: false,
				priority: 15,
			});
		} catch {
			/* no SRV */
		}
	}
	return out;
}

async function candidatesFromDnsGuesses(domain: string): Promise<ImapDiscoveryCandidate[]> {
	const out: ImapDiscoveryCandidate[] = [];
	for (const host of [`imap.${domain}`, `mail.${domain}`]) {
		if (!(await hostResolves(host))) continue;
		out.push({
			host,
			port: 993,
			secure: true,
			provider: "generic",
			source: "guess",
			verified: false,
			priority: host.startsWith("imap.") ? 40 : 45,
		});
	}
	return out;
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

	const thunderbird = await fetchThunderbirdAutoconfig(domain);
	if (thunderbird) {
		list.push({
			...thunderbird,
			provider: known ?? "generic",
			verified: false,
			priority: 5,
		});
	}

	const autoconfig = await fetchDomainAutoconfig(domain);
	if (autoconfig) {
		list.push({
			...autoconfig,
			provider: known ?? "generic",
			verified: false,
			priority: 8,
		});
	}

	list.push(...(await candidatesFromSrv(domain)));
	list.push(...(await candidatesFromMx(domain, trimmed)));
	list.push(...(await candidatesFromSharedHosting(domain)));
	list.push(...(await candidatesFromDnsGuesses(domain)));

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
	if (known && !options?.password?.trim()) {
		return presetForProvider(known, trimmed);
	}

	const candidates = await collectImapCandidates(trimmed, domain);
	if (candidates.length === 0) {
		throw new Error(
			`Could not find an IMAP server for ${domain}. Open “Show server settings” and enter the host from your email provider.`,
		);
	}

	const verified = await pickVerifiedCandidate(candidates, {
		email: trimmed,
		password: options?.password,
		toCredentials: (c) => ({
			provider: c.provider,
			email: trimmed,
			host: c.host,
			port: c.port,
			secure: c.secure,
			authMethod: "password",
			password: options?.password,
		}),
	});

	if (verified) {
		const { priority: _p, ...result } = verified;
		return { ...result, verified: true };
	}

	throw new Error(
		options?.password?.trim()
			? `No working IMAP server found for ${domain}. Check your password or enter the server manually under “Show server settings”.`
			: `Could not verify an IMAP server for ${domain}. Enter your password and try again, or set the server manually.`,
	);
}
