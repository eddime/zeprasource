import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	hashMessageSource,
	MigrationStagingStore,
} from "../migration-staging-store";

describe("MigrationStagingStore", () => {
	test("write and read round-trip with hash verification", async () => {
		const root = await mkdtemp(join(tmpdir(), "zepra-stage-"));
		const store = new MigrationStagingStore(root);
		const source = Buffer.from("From: a@b\r\n\r\nbody");
		const written = await store.write("INBOX", {
			uid: 42,
			source,
			flags: new Set(["\\Seen"]),
			internalDate: new Date("2024-06-01T12:00:00Z"),
			messageId: "<x@test>",
		});

		expect(written.sha256).toBe(hashMessageSource(source));
		const read = await store.read("INBOX", 42);
		expect(read?.uid).toBe(42);
		expect(read?.source.equals(source)).toBe(true);
		expect(read?.messageId).toBe("<x@test>");

		await store.remove("INBOX", 42);
		expect(store.has("INBOX", 42)).toBe(false);
		await rm(root, { recursive: true, force: true });
	});
});
