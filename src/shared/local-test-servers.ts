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
