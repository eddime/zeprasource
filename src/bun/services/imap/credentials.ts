import type { MailboxCredentials } from "../../../shared/types";
import { PROVIDER_PRESETS } from "../../../shared/types";
import { classifyMigrationError } from "../migration/migration-errors";

const OUTLOOK_CONSUMER_DOMAINS = [
	"outlook.com",
	"outlook.de",
	"hotmail.com",
	"hotmail.de",
	"live.com",
	"live.de",
	"msn.com",
];

export function resolveOutlookHost(email: string): string {
	const domain = email.split("@")[1]?.toLowerCase() ?? "";
	if (OUTLOOK_CONSUMER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
		return "imap-mail.outlook.com";
	}
	return "outlook.office365.com";
}

/** Split "host", "host:port", or "imap://host:port" from a single input field. */
export function parseImapHostInput(
	hostInput: string,
	portInput: number | string,
): { host: string; port: number } {
	let host = hostInput.trim().replace(/^imap(s)?:\/\//i, "").split("/")[0] ?? "";
	let port =
		typeof portInput === "string" ? Number.parseInt(portInput, 10) : portInput;

	if (host.includes(":")) {
		const [hostPart, portPart] = host.split(":");
		host = hostPart ?? host;
		const parsed = Number.parseInt(portPart ?? "", 10);
		if (Number.isFinite(parsed) && parsed > 0) port = parsed;
	}

	host = host.replace(/^\[|\]$/g, "");
	if (/^localhost$/i.test(host)) host = "127.0.0.1";

	return {
		host,
		port: Number.isFinite(port) && port > 0 ? port : 993,
	};
}

/** Normalize RPC/UI payload before IMAP connect. */
export function normalizeMailboxCredentials(
	credentials: MailboxCredentials,
): MailboxCredentials {
	const email = credentials.email.trim();
	const parsed = parseImapHostInput(credentials.host, credentials.port);
	let host = parsed.host;
	let port = parsed.port;
	let authMethod = credentials.authMethod;

	authMethod = "password";

	if (credentials.provider === "gmail" && !host) {
		host = PROVIDER_PRESETS.gmail.host;
	}
	if (credentials.provider === "outlook") {
		host = email ? resolveOutlookHost(email) : host || PROVIDER_PRESETS.outlook.host;
	}
	if (credentials.provider === "icloud" && !host) {
		host = PROVIDER_PRESETS.icloud.host;
	}

	const secureExplicit = credentials.secure === true || credentials.secure === false;
	const secure = secureExplicit
		? credentials.secure
		: port === 993;

	return {
		...credentials,
		email,
		host,
		port,
		secure,
		authMethod,
		username: credentials.username?.trim() || undefined,
		password: credentials.password?.trim() || undefined,
	};
}

export function validateMailboxCredentials(
	credentials: MailboxCredentials,
): string | null {
	if (!credentials.email) return "Email is required.";
	if (!credentials.host) return "IMAP server is required.";
	if (!credentials.password) {
		return "Password is required.";
	}
	return null;
}

type ImapError = Error & {
	responseText?: string;
	authenticationFailed?: boolean;
	code?: string;
	serverResponseCode?: string;
};

export function formatImapError(
	error: unknown,
	credentials: MailboxCredentials,
): string {
	if (!(error instanceof Error)) {
		return "Connection failed. Check your settings and try again.";
	}

	const err = error as ImapError;
	const classification = classifyMigrationError(error);
	const responseText = err.responseText?.trim();
	const authFailed =
		classification.kind === "auth";

	if (authFailed) {
		if (/dreamhost/i.test(credentials.host)) {
			return (
				"DreamHost login failed. Use your full email and the mailbox password from the DreamHost panel " +
				"(IMAP: imap.dreamhost.com, port 993, SSL on)."
			);
		}
		if (credentials.provider === "gmail") {
			return (
				"Gmail login failed. Use a Google app password (16 characters), not your normal " +
				"Google password. Create one at myaccount.google.com/apppasswords"
			);
		}
		if (credentials.provider === "outlook") {
			return (
				"Outlook login failed. Use your Microsoft password or an app password if 2FA is on. " +
				`Server: ${credentials.host}`
			);
		}
		if (credentials.provider === "icloud") {
			return (
				"iCloud login failed. Use an app-specific password from appleid.apple.com (not your Apple ID password)."
			);
		}
		return responseText
			? `Login failed: ${responseText}`
			: "Login failed. Check email and password.";
	}

	if (/ENOTFOUND|getaddrinfo/i.test(err.message)) {
		if (credentials.host.startsWith("127.0.0.1") || credentials.port === 1143) {
			return (
				`Server "${credentials.host}" was not found. Start local test servers: bun run imap:up`
			);
		}
		return (
			`Server "${credentials.host}" was not found. Check “Show server settings” or ask your hoster for the IMAP hostname.`
		);
	}

	if (/ECONNREFUSED/i.test(err.message)) {
		return (
			`Nothing is listening on ${credentials.host}:${credentials.port}. ` +
			"Start Docker test servers (bun run imap:up) or check host/port/TLS."
		);
	}

	if (/ETIMEOUT|Socket timeout/i.test(err.message) || err.code === "ETIMEOUT") {
		return (
			`Connection to ${credentials.host} timed out. Check host, port, TLS, and your network — ` +
			"or try again in a moment."
		);
	}

	if (classification.kind === "throttled") {
		return classification.userMessage;
	}

	if (responseText) return responseText;
	if (err.message && err.message !== "Command failed") return err.message;

	return "Connection failed. Check email, password, IMAP host, and port.";
}
