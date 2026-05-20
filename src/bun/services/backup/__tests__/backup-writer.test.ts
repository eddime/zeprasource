import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { writeBackupMessage } from "../backup-writer";

describe("backup-writer", () => {
	test("writes eml and skips existing file", async () => {
		const accountDir = join(tmpdir(), `zepra-backup-test-${randomUUID()}`);
		const raw = Buffer.from(
			"From: a@b\r\nTo: c@d\r\nSubject: test\r\n\r\nhello attachment-free",
		);

		const first = await writeBackupMessage({
			accountDir,
			folderPath: "INBOX",
			uid: 7,
			source: raw,
		});
		expect(first.status).toBe("written");
		expect(existsSync(first.path)).toBe(true);
		expect(readFileSync(first.path).equals(raw)).toBe(true);

		const second = await writeBackupMessage({
			accountDir,
			folderPath: "INBOX",
			uid: 7,
			source: raw,
		});
		expect(second.status).toBe("skipped");

		rmSync(accountDir, { recursive: true, force: true });
	});
});
