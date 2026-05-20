import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../database";
import {
	getMigrationProgressSnapshot,
	seedMigrationFolderTotals,
	syncMigrationCounters,
	updateFolderScannedTotal,
} from "../migration-repository";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "zepra-migration-test-"));
	process.env.ZEPRA_DATA_DIR = tempDir;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
});

afterEach(() => {
	delete process.env.ZEPRA_DATA_DIR;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("migration-repository", () => {
	test("seedMigrationFolderTotals uses folder-view message estimates", () => {
		const db = getDatabase();
		const migrationId = "test-migration-1";

		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, folder_mappings, started_at, updated_at
      ) VALUES (?, 's', 'd', 'a@test.com', 'b@test.com', 'running', 2, '[]', datetime('now'), datetime('now'))`,
		).run(migrationId);

		const total = seedMigrationFolderTotals(migrationId, [
			{ sourcePath: "INBOX", destPath: "INBOX", selected: true, messages: 120 },
			{ sourcePath: "Sent", destPath: "Sent", selected: true, messages: 30 },
		]);

		expect(total).toBe(150);

		const progress = getMigrationProgressSnapshot(migrationId, "running", undefined, {
			reconcile: false,
		});
		expect(progress?.messagesTotal).toBe(150);
		expect(progress?.messagesCompleted).toBe(0);
	});

	test("syncMigrationCounters restores completed message count after restart", () => {
		const db = getDatabase();
		const migrationId = "test-migration-2";

		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, messages_total, messages_completed, started_at, updated_at
      ) VALUES (?, 's', 'd', 'a@test.com', 'b@test.com', 'running', 1, 100, 0, datetime('now'), datetime('now'))`,
		).run(migrationId);

		db.prepare(
			`INSERT INTO migration_folders (migration_id, source_path, dest_path, status, messages_total)
       VALUES (?, 'INBOX', 'INBOX', 'running', 100)`,
		).run(migrationId);

		for (let uid = 1; uid <= 42; uid++) {
			db.prepare(
				`INSERT INTO migration_messages (migration_id, source_folder, source_uid, status, size_bytes)
         VALUES (?, 'INBOX', ?, 'completed', 1000)`,
			).run(migrationId, uid);
		}

		syncMigrationCounters(migrationId);

		const progress = getMigrationProgressSnapshot(migrationId, undefined, undefined, {
			reconcile: false,
		});
		expect(progress?.messagesCompleted).toBe(42);
		expect(progress?.messagesTotal).toBe(100);
	});

	test("updateFolderScannedTotal never lowers the folder-view estimate", () => {
		const db = getDatabase();
		const migrationId = "test-migration-3";

		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, messages_total, started_at, updated_at
      ) VALUES (?, 's', 'd', 'a@test.com', 'b@test.com', 'running', 1, 200, datetime('now'), datetime('now'))`,
		).run(migrationId);

		db.prepare(
			`INSERT INTO migration_folders (migration_id, source_path, dest_path, status, messages_total)
       VALUES (?, 'INBOX', 'INBOX', 'pending', 200)`,
		).run(migrationId);

		const afterScan = updateFolderScannedTotal(migrationId, "INBOX", 50);
		expect(afterScan).toBe(200);
	});
});
