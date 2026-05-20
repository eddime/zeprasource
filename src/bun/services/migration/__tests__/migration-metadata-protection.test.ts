import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../../../db/database";
import { listMigrations } from "../../../db/database";
import { prepareMigrationStart } from "../migration-engine";
import { loadMigrationResumePayload } from "../migration-resume";
import type { MailboxCredentials } from "../../../../shared/types";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "zepra-migration-metadata-test-"));
	process.env.ZEPRA_DATA_DIR = tempDir;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
});

afterEach(() => {
	delete process.env.ZEPRA_DATA_DIR;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
	rmSync(tempDir, { recursive: true, force: true });
});

function mailbox(email: string): MailboxCredentials {
	return {
		provider: "generic",
		email,
		host: "imap.example.com",
		port: 993,
		secure: true,
		authMethod: "password",
		password: "app-password",
	};
}

describe("migration metadata protection", () => {
	test("stores migration history email and folder mappings encrypted while APIs return plaintext", async () => {
		const migrationId = await prepareMigrationStart({
			source: mailbox("source@example.com"),
			destination: mailbox("dest@example.com"),
			folderMappings: [
				{
					sourcePath: "Private/Invoices",
					destPath: "Imported/Invoices",
					selected: true,
					messages: 3,
				},
			],
		});

		const row = getDatabase()
			.query(
				"SELECT source_email, dest_email, folder_mappings FROM migrations WHERE id = ?",
			)
			.get(migrationId) as {
			source_email: string;
			dest_email: string;
			folder_mappings: string;
		};

		expect(row.source_email).not.toContain("source@example.com");
		expect(row.dest_email).not.toContain("dest@example.com");
		expect(row.folder_mappings).not.toContain("Private/Invoices");

		const [record] = listMigrations(1);
		expect(record?.sourceEmail).toBe("source@example.com");
		expect(record?.destEmail).toBe("dest@example.com");

		const resume = loadMigrationResumePayload(migrationId);
		expect(resume?.folderMappings[0]?.sourcePath).toBe("Private/Invoices");
	});
});
