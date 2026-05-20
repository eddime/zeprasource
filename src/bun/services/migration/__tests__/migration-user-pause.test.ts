import { describe, expect, test } from "bun:test";
import { getDatabase } from "../../../db/database";
import {
	isUserPausedMigration,
	setUserPausedFlag,
} from "../../../db/migration-repository";

describe("user pause flag", () => {
	test("setUserPausedFlag toggles isUserPausedMigration", () => {
		const db = getDatabase();
		const id = crypto.randomUUID();
		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, folder_mappings, updated_at
      ) VALUES (?, 's', 'd', 'a@b.c', 'd@e.f', 'paused', 1, '[]', datetime('now'))`,
		).run(id);

		expect(isUserPausedMigration(id)).toBe(false);
		setUserPausedFlag(id, true);
		expect(isUserPausedMigration(id)).toBe(true);
		setUserPausedFlag(id, false);
		expect(isUserPausedMigration(id)).toBe(false);
	});
});
