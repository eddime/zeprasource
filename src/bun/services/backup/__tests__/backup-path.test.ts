import { describe, expect, test } from "bun:test";
import {
	backupMessageFilePath,
	resolveBackupAccountDir,
	sanitizePathSegment,
} from "../../../../shared/backup-path";

describe("backup-path", () => {
	test("sanitizePathSegment removes unsafe characters", () => {
		expect(sanitizePathSegment("INBOX/Sent")).toBe("INBOX_Sent");
		expect(sanitizePathSegment("[Gmail]/All Mail")).toBe("[Gmail]_All Mail");
	});

	test("resolveBackupAccountDir nests under parent", () => {
		const account = resolveBackupAccountDir("/tmp/Zepra-Backup", "max@gmail.com");
		expect(account).toBe("/tmp/Zepra-Backup/max@gmail.com");
		const file = backupMessageFilePath(account, "INBOX", 42);
		expect(file).toEndWith("/INBOX/42.eml");
	});
});
