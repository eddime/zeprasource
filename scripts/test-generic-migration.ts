/**
 * End-to-end generic IMAP migration test using two Ethereal.email mailboxes.
 * Run: bun run test:generic
 *
 * For fully local servers (Docker): bun run test:generic:local
 */
process.env.ZEPRA_DATA_DIR ??= `${import.meta.dir}/../.test-fixtures/data`;

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { getDatabase } from "../src/bun/db/database";
import { startMigration } from "../src/bun/services/migration/migration-engine";
import { testImapConnection } from "../src/bun/services/imap/imap-client";
import type { FolderMapping, MailboxCredentials } from "../src/shared/types";

type EtherealAccount = Awaited<ReturnType<typeof nodemailer.createTestAccount>>;

function toCredentials(account: EtherealAccount, label: string): MailboxCredentials {
	return {
		provider: "generic",
		email: account.user,
		host: account.imap.host,
		port: account.imap.port,
		secure: account.imap.secure,
		authMethod: "password",
		username: account.user,
		password: account.pass,
	};
}

async function seedInbox(account: EtherealAccount, subject: string): Promise<void> {
	const transport = nodemailer.createTransport({
		host: account.smtp.host,
		port: account.smtp.port,
		secure: account.smtp.secure,
		auth: { user: account.user, pass: account.pass },
	});

	await transport.sendMail({
		from: account.user,
		to: account.user,
		subject,
		text: `Zepra generic migration test at ${new Date().toISOString()}`,
		messageId: `<zepra-test-${Date.now()}@local.test>`,
	});

	await transport.close();
}

async function countInboxMessages(creds: MailboxCredentials): Promise<number> {
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
	console.log("Creating two Ethereal IMAP accounts (source + destination)…");
	const [sourceAccount, destAccount] = await Promise.all([
		nodemailer.createTestAccount(),
		nodemailer.createTestAccount(),
	]);

	const source = toCredentials(sourceAccount, "source");
	const destination = toCredentials(destAccount, "dest");

	const testSubject = `Zepra-E2E-${Date.now()}`;
	console.log("Seeding source INBOX…");
	await seedInbox(sourceAccount, testSubject);

	const sourceBefore = await countInboxMessages(source);
	const destBefore = await countInboxMessages(destination);
	console.log(`Source messages: ${sourceBefore}, Dest messages: ${destBefore}`);

	console.log("Testing generic IMAP connections…");
	const sourceTest = await testImapConnection(source);
	if (!sourceTest.success) {
		throw new Error(`Source test failed: ${sourceTest.error}`);
	}
	const destTest = await testImapConnection(destination);
	if (!destTest.success) {
		throw new Error(`Dest test failed: ${destTest.error}`);
	}
	console.log("Both connections OK.");

	const folderMappings: FolderMapping[] = (sourceTest.folders ?? [])
		.filter((f) => f.path === "INBOX" || !f.attributes.includes("\\Noselect"))
		.slice(0, 1)
		.map((f) => ({
			sourcePath: f.path,
			destPath: f.path,
			selected: true,
		}));

	if (!folderMappings.length) {
		folderMappings.push({ sourcePath: "INBOX", destPath: "INBOX", selected: true });
	}

	getDatabase();

	let finalStatus = "";
	await startMigration({ source, destination, folderMappings }, (progress) => {
		finalStatus = progress.status;
		if (progress.messagesCompleted % 1 === 0) {
			console.log(
				`  progress: ${progress.messagesCompleted}/${progress.messagesTotal} msgs, status=${progress.status}`,
			);
		}
	});

	const sourceAfter = await countInboxMessages(source);
	const destAfter = await countInboxMessages(destination);
	console.log(`After migration — source: ${sourceAfter}, dest: ${destAfter}`);

	if (finalStatus !== "completed") {
		throw new Error(`Migration ended with status: ${finalStatus}`);
	}
	if (destAfter <= destBefore) {
		throw new Error("No new messages on destination after migration.");
	}

	console.log("\n✅ Generic IMAP migration test passed.");
}

main().catch((error) => {
	console.error("\n❌ Test failed:", error instanceof Error ? error.message : error);
	process.exit(1);
});
