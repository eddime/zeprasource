/** Single inbox folder used for POP3 sources (mirrors typical IMAP INBOX). */
export const POP3_INBOX_PATH = "INBOX";

export type MailAccessProtocol = "imap" | "pop3";

export function resolveMailAccessProtocol(
	protocol: MailAccessProtocol | undefined,
): MailAccessProtocol {
	return protocol === "pop3" ? "pop3" : "imap";
}

export function isPop3Access(
	protocol: MailAccessProtocol | undefined,
): boolean {
	return resolveMailAccessProtocol(protocol) === "pop3";
}
