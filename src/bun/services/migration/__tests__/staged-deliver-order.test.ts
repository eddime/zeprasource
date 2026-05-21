import { describe, expect, test } from "bun:test";
import { getDatabase } from "../../../db/database";
import {
	listStagedUidsForFolder,
	listStagedUidsForFolderBySize,
	markMigrationMessage,
} from "../../../db/migration-repository";

describe("staged deliver order", () => {
	test("listStagedUidsForFolder returns smallest size_bytes first", () => {
		const db = getDatabase();
		const migrationId = crypto.randomUUID();
		const folder = "INBOX";

		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email, status, folders_total, updated_at
      ) VALUES (?, 's', 'd', 'a@test.com', 'b@test.com', 'running', 1, datetime('now'))`,
		).run(migrationId);

		for (const row of [
			{ uid: 10, size: 500_000 },
			{ uid: 11, size: 1_200 },
			{ uid: 12, size: 80_000 },
		]) {
			markMigrationMessage(
				db,
				migrationId,
				folder,
				row.uid,
				"staged",
				row.size,
				undefined,
				undefined,
				0,
				"abc",
			);
		}

		const sorted = listStagedUidsForFolderBySize(migrationId, folder);
		expect(sorted.map((r) => r.uid)).toEqual([11, 12, 10]);
		expect(listStagedUidsForFolder(migrationId, folder)).toEqual([11, 12, 10]);
	});
});
