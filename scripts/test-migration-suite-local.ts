/**
 * Runs local migration tests: generic, turbo staging, compression probe.
 * Requires: bun run imap:up
 */
process.env.ZEPRA_DATA_DIR ??= `${import.meta.dir}/../.test-fixtures/suite`;

import { spawn } from "node:child_process";
import {
	connectImapClient,
	describeImapCompression,
	isImapDeflateActive,
} from "../src/bun/services/imap/imap-client";
import type { MailboxCredentials } from "../src/shared/types";

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

async function probeCompression(label: string, creds: MailboxCredentials): Promise<void> {
	const client = await connectImapClient(creds, "migration");
	const cap = [...client.capabilities.keys()].filter((k) => /COMPRESS/i.test(k));
	console.log(
		`  ${label}: wire=${describeImapCompression(client)} deflate=${isImapDeflateActive(client)} caps=${cap.join(",") || "none"}`,
	);
	await client.logout();
}

function runScript(script: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", ["run", script], {
			stdio: "inherit",
			env: { ...process.env, ZEPRA_DATA_DIR: process.env.ZEPRA_DATA_DIR },
		});
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${script} exited ${code}`));
		});
	});
}

async function main() {
	console.log("=== IMAP compression probe (local) ===");
	await probeCompression("source", source);
	await probeCompression("dest", destination);

	console.log("\n=== Unit tests ===");
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			"bun",
			[
				"test",
				"src/bun/services/imap/__tests__/imap-compression.test.ts",
				"src/bun/services/migration/__tests__/migration-staging-store.test.ts",
				"src/bun/services/migration/__tests__/migration-lanes.test.ts",
				"src/bun/services/migration/__tests__/migration-provider-profile.test.ts",
			],
			{ stdio: "inherit" },
		);
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`unit tests ${code}`))));
	});

	console.log("\n=== Turbo staging migration ===");
	process.env.ZEPRA_DATA_DIR = `${import.meta.dir}/../.test-fixtures/suite-turbo`;
	await runScript("test:turbo:local");

	console.log("\n=== Generic migration ===");
	process.env.ZEPRA_DATA_DIR = `${import.meta.dir}/../.test-fixtures/suite-generic`;
	await runScript("test:generic:local");

	console.log("\n✅ Migration suite passed");
}

main().catch((e) => {
	console.error("❌", e instanceof Error ? e.message : e);
	process.exit(1);
});
