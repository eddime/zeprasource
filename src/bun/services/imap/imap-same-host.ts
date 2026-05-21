import type { MailboxCredentials } from "../../../shared/types";

function normalizeHost(host: string): string {
	return host.trim().toLowerCase().replace(/\.$/, "");
}

/** Same IMAP endpoint (host + port). */
export function isSameImapEndpoint(
	source: MailboxCredentials,
	destination: MailboxCredentials,
): boolean {
	return (
		normalizeHost(source.host) === normalizeHost(destination.host) &&
		source.port === destination.port
	);
}

/** IMAP COPY works only when both sides are the same mailbox account (folder → folder). */
export function canUseServerSideCopy(
	source: MailboxCredentials,
	destination: MailboxCredentials,
	backupOnly: boolean,
): boolean {
	if (backupOnly) return false;
	if (!isSameImapEndpoint(source, destination)) return false;
	return source.email.trim().toLowerCase() === destination.email.trim().toLowerCase();
}
