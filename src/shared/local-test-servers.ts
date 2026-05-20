import type { MailboxCredentials } from "./types";

/** Local GreenMail instances — start with: docker compose -f docker-compose.test-imap.yml up */
export const LOCAL_IMAP_SOURCE: MailboxCredentials = {
	provider: "generic",
	email: "source@test",
	host: "127.0.0.1",
	port: 1143,
	secure: false,
	authMethod: "password",
	username: "source@test",
	password: "source",
};

export const LOCAL_IMAP_DEST: MailboxCredentials = {
	provider: "generic",
	email: "dest@test",
	host: "127.0.0.1",
	port: 2143,
	secure: false,
	authMethod: "password",
	username: "dest@test",
	password: "dest",
};

export const LOCAL_IMAP_DOCKER_CMD =
	"docker compose -f docker-compose.test-imap.yml up";

const LOCAL_TEST_PORTS = new Set([LOCAL_IMAP_SOURCE.port, LOCAL_IMAP_DEST.port]);

export function isLocalTestEmail(email: string): boolean {
	return /@test$/i.test(email.trim());
}

export function isLocalTestMailbox(credentials: {
	email?: string;
	host?: string;
	port?: number;
}): boolean {
	const host = credentials.host?.trim().toLowerCase() ?? "";
	if (host === "127.0.0.1" || host === "localhost") return true;
	if (credentials.port && LOCAL_TEST_PORTS.has(credentials.port)) return true;
	return Boolean(credentials.email && isLocalTestEmail(credentials.email));
}

export function localTestMissingHostHint(role: "source" | "destination"): string {
	return `For local test mail, click “Use as ${role === "source" ? "From" : "To"}” in the test panel below.`;
}
