import { afterEach, describe, expect, test } from "bun:test";
import {
	cancelMigration,
	enqueueMigration,
	getActiveMigrationIds,
	MAX_CONCURRENT_MIGRATIONS,
	MigrationCapacityError,
} from "../migration-engine";

const emit = () => {};

const startParams = (i: number) => ({
	source: {
		provider: "generic" as const,
		email: `a${i}@test.com`,
		host: "imap.test",
		port: 993,
		secure: true,
		authMethod: "password" as const,
		password: "x",
	},
	destination: {
		provider: "generic" as const,
		email: `b${i}@test.com`,
		host: "imap.test",
		port: 993,
		secure: true,
		authMethod: "password" as const,
		password: "x",
	},
	folderMappings: [{ sourcePath: "INBOX", destPath: "INBOX", selected: true }],
});

async function waitForActiveCount(
	target: number,
	timeoutMs = 2000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const n = getActiveMigrationIds().length;
		if (target === 0 ? n === 0 : n >= target) return;
		await Bun.sleep(10);
	}
	throw new Error(`Timed out waiting for ${target} active migrations`);
}

describe("migration concurrency", () => {
	afterEach(async () => {
		for (const id of getActiveMigrationIds()) {
			cancelMigration(id);
		}
		await waitForActiveCount(0, 5000);
	});

	test("enqueueMigration rejects when at capacity", async () => {
		const ids: string[] = [];
		try {
			for (let i = 0; i < MAX_CONCURRENT_MIGRATIONS; i++) {
				ids.push(await enqueueMigration(startParams(i), emit));
			}
			await waitForActiveCount(MAX_CONCURRENT_MIGRATIONS);
			expect(getActiveMigrationIds().length).toBe(MAX_CONCURRENT_MIGRATIONS);

			await expect(
				enqueueMigration(startParams(99), emit),
			).rejects.toThrow(MigrationCapacityError);
		} finally {
			for (const id of ids) {
				cancelMigration(id);
			}
			await waitForActiveCount(0, 5000);
		}
	});

	test("enqueueMigration returns id without blocking", async () => {
		const id = await enqueueMigration(startParams(0), emit);
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		expect(getActiveMigrationIds()).toContain(id);
		cancelMigration(id);
	});
});
