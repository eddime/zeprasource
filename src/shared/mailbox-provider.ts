import type { MailboxCredentials, MailboxProvider } from "./types";
import { PROVIDER_PRESETS } from "./types";

const OUTLOOK_DOMAINS = new Set([
	"outlook.com",
	"outlook.de",
	"hotmail.com",
	"hotmail.de",
	"live.com",
	"live.de",
	"msn.com",
]);

export function emailDomain(email: string): string | null {
	const domain = email.split("@")[1]?.trim().toLowerCase();
	return domain || null;
}

/** Known consumer providers from the email domain; null → generic + autodiscover. */
export function detectProviderFromEmail(email: string): MailboxProvider | null {
	const domain = emailDomain(email);
	if (!domain) return null;
	if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
	if (OUTLOOK_DOMAINS.has(domain)) return "outlook";
	if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
		return "icloud";
	}
	return null;
}

export function resolveProviderFromEmail(email: string): MailboxProvider {
	return detectProviderFromEmail(email) ?? "generic";
}

/**
 * Keep provider and IMAP host in sync with the email field.
 * Clears host when the address changes, then applies a known-provider preset if any.
 */
export function applyProviderFromEmail(
	credentials: MailboxCredentials,
	email: string,
	previousEmail?: string,
): boolean {
	const trimmed = email.trim();
	const prevTrimmed = previousEmail?.trim();
	const emailChanged =
		previousEmail !== undefined && trimmed !== prevTrimmed;

	if (emailChanged) {
		credentials.host = "";
	}

	const previousProvider = credentials.provider;
	const next = resolveProviderFromEmail(trimmed);
	const oldPreset = PROVIDER_PRESETS[previousProvider];
	const hostWasPreset = Boolean(oldPreset.host && credentials.host === oldPreset.host);

	credentials.provider = next;
	const preset = PROVIDER_PRESETS[next];
	if (preset.host) {
		credentials.host = preset.host;
		credentials.port = preset.port;
		credentials.secure = preset.secure;
	} else if (emailChanged || hostWasPreset || !credentials.host) {
		credentials.host = "";
	}
	if (next !== "generic") {
		credentials.username = undefined;
	}

	return next !== previousProvider;
}
