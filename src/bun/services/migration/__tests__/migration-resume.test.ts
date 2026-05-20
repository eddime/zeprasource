import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../../../db/database";
import { checkpointInterruptedMigrations } from "../migration-resume";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "zepra-resume-test-"));
	process.env.ZEPRA_DATA_DIR = tempDir;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
});

afterEach(() => {
	delete process.env.ZEPRA_DATA_DIR;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("migration-resume checkpoint", () => {
	test("running migrations become paused and are returned for auto-resume", () => {
		const db = getDatabase();
		db.prepare(
			`INSERT INTO migrations (
        id, source_profile_id, dest_profile_id, source_email, dest_email,
        status, folders_total, started_at, updated_at
      ) VALUES ('run-1', 's', 'd', 'a@test.com', 'b@test.com', 'running', 1, datetime('now'), datetime('now'))`,
		).run();

		const ids = checkpointInterruptedMigrations();
		expect(ids).toContain("run-1");

		const row = db
			.query(`SELECT status FROM migrations WHERE id = 'run-1'`)
			.get() as { status: string };
		expect(row.status).toBe("paused");
	});
});
