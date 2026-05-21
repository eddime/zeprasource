import type { ImapFlow } from "imapflow";

export type ImapSessionPrefs = {
	/** When true, skip COMPRESS=DEFLATE on connect/reconnect. */
	disableCompression: boolean;
};

const sessionPrefsByCredentials = new WeakMap<MailboxCredentialsLike, ImapSessionPrefs>();

type MailboxCredentialsLike = { host: string; port: number };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

/** Local GreenMail / dev — compression adds CPU, no real bandwidth win. */
export function isLocalImapHost(host: string): boolean {
	const h = host.trim().toLowerCase();
	return LOCAL_HOSTS.has(h);
}

/** Prefer wire compression for real migrations over the internet. */
export function preferImapCompression(host: string, mode: "migration" | "test" | "probe"): boolean {
	if (mode !== "migration") return false;
	return !isLocalImapHost(host);
}

export function getImapSessionPrefs(credentials: MailboxCredentialsLike): ImapSessionPrefs {
	return sessionPrefsByCredentials.get(credentials) ?? { disableCompression: false };
}

export function setImapSessionPrefs(
	credentials: MailboxCredentialsLike,
	prefs: ImapSessionPrefs,
): void {
	sessionPrefsByCredentials.set(credentials, prefs);
}

export function serverAdvertisesCompress(client: ImapFlow): boolean {
	return client.capabilities.has("COMPRESS");
}

/** True when RFC 4978 DEFLATE stream is active on this session. */
export function isImapDeflateActive(client: ImapFlow): boolean {
	const internal = client as ImapFlow & { _deflate?: unknown };
	return Boolean(internal._deflate);
}

export function describeImapCompression(client: ImapFlow): string {
	if (isImapDeflateActive(client)) return "DEFLATE";
	if (serverAdvertisesCompress(client)) return "available-not-active";
	return "off";
}

/** Retry connect without compression when COMPRESS negotiation or zlib stream fails. */
export function shouldRetryImapWithoutCompression(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const text = `${error.message} ${(error as Error & { code?: string }).code ?? ""}`;
	return /COMPRESS|deflate|inflate|zlib|invalid stored block|incorrect header check|unexpected end of data/i.test(
		text,
	);
}
