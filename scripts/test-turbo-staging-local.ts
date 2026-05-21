/**
 * Turbo staging migration test (local GreenMail).
 * Run: bun run imap:up && bun run test:turbo:local
 */
process.env.ZEPRA_DATA_DIR ??= `${import.meta.dir}/../.test-fixtures/turbo-staging`;

import { ImapFlow } from "imapflow";
import { getDatabase } from "../src/bun/db/database";
import { testImapConnection } from "../src/bun/services/imap/imap-client";
import { startMigration } from "../src/bun/services/migration/migration-engine";
import { migrationStagingRoot } from "../src/bun/services/migration/migration-staging-path";
import { join } from "node:path";
import { listStagedUidsForFolder } from "../src/bun/db/migration-repository";
import type { FolderMapping, MailboxCredentials, MigrationProgress } from "../src/shared/types";

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

async function clearInbox(creds: MailboxCredentials): Promise<void> {
	const client = new ImapFlow({
		host: creds.host,
		port: creds.port,
		secure: creds.secure,
		auth: { user: creds.username ?? creds.email, pass: creds.password ?? "" },
		logger: false,
	});
	await client.connect();
	try {
		const lock = await client.getMailboxLock("INBOX");
		try {
			const uids = await client.search({ all: true }, { uid: true });
			if (Array.isArray(uids) && uids.length > 0) {
				await client.messageDelete(uids, { uid: true });
			}
		} finally {
			lock.release();
		}
	} finally {
		await client.logout();
	}
}

async function seedSource(count: number): Promise<void> {
	const client = new ImapFlow({
		host: source.host,
		port: source.port,
		secure: false,
		auth: { user: source.username!, pass: source.password! },
		logger: false,
	});
	await client.connect();
	for (let i = 0; i < count; i++) {
		const raw = [
			"From: source@test",
			"To: source@test",
			`Subject: Turbo test ${i} ${Date.now()}`,
			`Message-ID: <turbo-${i}-${Date.now()}@localhost>`,
			"",
			`Body ${i}`,
		].join("\r\n");
		await client.append("INBOX", raw);
	}
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
	const sourceTest = await testImapConnection(source);
	if (!sourceTest.success) {
		throw new Error(`Source down: ${sourceTest.error}. Run: bun run imap:up`);
	}
	const destTest = await testImapConnection(destination);
	if (!destTest.success) {
		throw new Error(`Dest down: ${destTest.error}`);
	}

	await clearInbox(source);
	await clearInbox(destination);
	await seedSource(5);
	const destBefore = await countInbox(destination);

	const folderMappings: FolderMapping[] = [
		{ sourcePath: "INBOX", destPath: "INBOX", selected: true },
	];

	getDatabase();
	let last: MigrationProgress | null = null;
	const migrationId = await startMigration({ source, destination, folderMappings }, (p) => {
		last = p;
	});

	const destAfter = await countInbox(destination);
	if (last?.status !== "completed" || destAfter <= destBefore) {
		throw new Error(
			`Migration failed: status=${last?.status}, dest ${destBefore} -> ${destAfter}`,
		);
	}

	const stagedLeft = listStagedUidsForFolder(migrationId, "INBOX");
	if (stagedLeft.length > 0) {
		throw new Error(`Expected no staged UIDs after complete, got ${stagedLeft.length}`);
	}

	const stagingDir = join(migrationStagingRoot(migrationId), "INBOX");
	const { readdir } = await import("node:fs/promises");
	let leftover: string[] = [];
	try {
		leftover = (await readdir(stagingDir)).filter((f) => f.endsWith(".eml"));
	} catch {
		/* folder removed — ok */
	}
	if (leftover.length > 0) {
		throw new Error(`Staging files should be removed after upload (${leftover.length} left)`);
	}

	console.log(
		`✅ Turbo staging migration passed (${destAfter - destBefore} messages, id ${migrationId})`,
	);
}

main().catch((e) => {
	console.error("❌", e instanceof Error ? e.message : e);
	process.exit(1);
});
