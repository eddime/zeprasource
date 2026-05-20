/**
 * Generic migration between two local GreenMail instances (docker-compose.test-imap.yml).
 * Run: docker compose -f docker-compose.test-imap.yml up -d
 *      bun run test:generic:local
 */
process.env.ZEPRA_DATA_DIR ??= `${import.meta.dir}/../.test-fixtures/data`;

import { ImapFlow } from "imapflow";
import { getDatabase } from "../src/bun/db/database";
import { testImapConnection } from "../src/bun/services/imap/imap-client";
import { startMigration } from "../src/bun/services/migration/migration-engine";
import type { FolderMapping, MailboxCredentials } from "../src/shared/types";

const source: MailboxCredentials = {
	provider: "generic",
	email: "source@test",
	host: "127.0.0.1",
	port: 1143,
	secure: false,
	authMethod: "password",
	username: "source@test",
	password: "source",
};

const destination: MailboxCredentials = {
	provider: "generic",
	email: "dest@test",
	host: "127.0.0.1",
	port: 2143,
	secure: false,
	authMethod: "password",
	username: "dest@test",
	password: "dest",
};

async function seedSource(): Promise<void> {
	const client = new ImapFlow({
		host: source.host,
		port: source.port,
		secure: false,
		auth: { user: source.username!, pass: source.password! },
		logger: false,
	});
	await client.connect();
	const raw = [
		"From: source@test",
		"To: source@test",
		`Subject: Zepra local test ${Date.now()}`,
		"Message-ID: <zepra-local-test@localhost>",
		"",
		"Local generic migration body",
	].join("\r\n");
	await client.append("INBOX", raw);
	await client.logout();
}

async function countInbox(creds: MailboxCredentials): Promise<number> {
	const client = new ImapFlow({
		host: creds.host,
		port: creds.port,
		secure: creds.secure,
		auth: { user: creds.username ?? creds.email, pass: creds.password ?? "" },
		logger: false,
	});
	await client.connect();
	const lock = await client.getMailboxLock("INBOX");
	try {
		const uids = await client.search({ all: true }, { uid: true });
		return Array.isArray(uids) ? uids.length : 0;
	} finally {
		lock.release();
		await client.logout();
	}
}

async function main() {
	console.log("Connecting to local IMAP on :1143 and :2143…");
	const sourceTest = await testImapConnection(source);
	if (!sourceTest.success) {
		throw new Error(
			`Source unreachable (${sourceTest.error}). Start: docker compose -f docker-compose.test-imap.yml up`,
		);
	}
	const destTest = await testImapConnection(destination);
	if (!destTest.success) {
		throw new Error(`Dest unreachable (${destTest.error}).`);
	}

	await seedSource();
	const destBefore = await countInbox(destination);

	const folderMappings: FolderMapping[] = [
		{ sourcePath: "INBOX", destPath: "INBOX", selected: true },
	];

	getDatabase();
	let status = "";
	await startMigration({ source, destination, folderMappings }, (p) => {
		status = p.status;
	});

	const destAfter = await countInbox(destination);
	if (status !== "completed" || destAfter <= destBefore) {
		throw new Error(`Migration failed: status=${status}, dest ${destBefore} -> ${destAfter}`);
	}
	console.log("✅ Local generic migration passed.");
}

main().catch((e) => {
	console.error("❌", e instanceof Error ? e.message : e);
	process.exit(1);
});
