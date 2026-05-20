import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabasePath } from "../../../db/database";
import { credentialStore } from "../credential-store";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "zepra-credential-test-"));
	process.env.ZEPRA_DATA_DIR = tempDir;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
});

afterEach(() => {
	delete process.env.ZEPRA_DATA_DIR;
	(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset?.();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("credential-store paths", () => {
	test("uses the same data directory override as the database", () => {
		expect(getDatabasePath()).toBe(join(tempDir, "mailport.db"));

		credentialStore.store("test/ref", "secret");

		expect(credentialStore.retrieve("test/ref")).toBe("secret");
		expect(existsSync(join(tempDir, "vault", "credentials.json"))).toBe(true);
	});
});
