import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../../../db/database";
import {
	loadMailboxCredentialsByRole,
	loadMailboxProfileForDisplay,
	saveMailboxProfile,
} from "../mailbox-profile";
import type { MailboxCredentials } from "../../../../shared/types";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "zepra-profile-test-"));
	process.env.ZEPRA_DATA_DIR = tempDir;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
});

afterEach(() => {
	delete process.env.ZEPRA_DATA_DIR;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
	rmSync(tempDir, { recursive: true, force: true });
});

function credentials(overrides: Partial<MailboxCredentials> = {}): MailboxCredentials {
	return {
		provider: "generic",
		email: "source@example.com",
		host: "imap.example.com",
		port: 993,
		secure: true,
		authMethod: "password",
		username: "source@example.com",
		password: "app-password",
		...overrides,
	};
}

describe("mailbox-profile", () => {
	test("saves one profile per role and reloads credentials with optional display redaction", () => {
		const first = saveMailboxProfile("source", credentials());
		const second = saveMailboxProfile(
			"source",
			credentials({
				email: "new-source@example.com",
				password: "new-password",
			}),
		);

		expect(second.profileId).not.toBe(first.profileId);

		const rows = getDatabase()
			.query("SELECT email FROM mailbox_profiles WHERE role = 'source'")
			.all() as Array<{ email: string }>;
		expect(rows).toEqual([{ email: "new-source@example.com" }]);

		expect(loadMailboxCredentialsByRole("source")?.password).toBe("new-password");
		expect(loadMailboxProfileForDisplay("source")?.password).toBeUndefined();
	});
});
