import { describe, expect, test } from "bun:test";
import { messagesAccountedFor, migrationPercent } from "../migration-sessions";
import type { MigrationProgress } from "../types";

function progress(
	overrides: Partial<MigrationProgress> = {},
): MigrationProgress {
	return {
		migrationId: "m1",
		status: "running",
		foldersTotal: 1,
		foldersCompleted: 0,
		messagesTotal: 100,
		messagesCompleted: 90,
		messagesFailed: 0,
		bytesTransferred: 0,
		updatedAt: "2026-05-20T12:00:00.000Z",
		...overrides,
	};
}

describe("migrationPercent", () => {
	test("includes failed messages so the bar does not stall at 90%", () => {
		const p = progress({ messagesCompleted: 90, messagesFailed: 10 });
		expect(messagesAccountedFor(p)).toBe(100);
		expect(migrationPercent(p)).toBe(100);
	});

	test("uses only completed when nothing failed yet", () => {
		expect(migrationPercent(progress({ messagesCompleted: 45, messagesFailed: 0 }))).toBe(
			45,
		);
	});

	test("reaches 100% when all messages are accounted for", () => {
		expect(
			migrationPercent(
				progress({ messagesCompleted: 90, messagesFailed: 10, messagesTotal: 100 }),
			),
		).toBe(100);
	});

	test("hits 100% when accounted meets inflated total", () => {
		expect(
			migrationPercent(
				progress({ messagesCompleted: 85, messagesFailed: 5, messagesTotal: 90 }),
			),
		).toBe(100);
	});
});
