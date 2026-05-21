import { describe, expect, test } from "bun:test";
import {
	buildMigrationSizeEstimate,
	folderMappingsToSizeEstimates,
} from "../migration-size-estimate";

describe("migration-size-estimate", () => {
	test("buildMigrationSizeEstimate sums folders and payment flag", () => {
		const estimate = buildMigrationSizeEstimate({
			folders: [
				{ path: "INBOX", messages: 10, bytes: 3 * 1024 ** 3 },
				{ path: "Sent", messages: 5, bytes: 1024 ** 3 },
			],
			sourceProvider: "gmail",
			destProvider: "generic",
			pricing: { configured: true, freeLimitBytes: 2 * 1024 ** 3 },
		});

		expect(estimate.totalBytes).toBe(4 * 1024 ** 3);
		expect(estimate.messageCount).toBe(15);
		expect(estimate.requiresPayment).toBe(true);
		expect(estimate.folders).toHaveLength(2);
	});

	test("folderMappingsToSizeEstimates returns null when stats missing", () => {
		expect(
			folderMappingsToSizeEstimates([
				{
					sourcePath: "INBOX",
					destPath: "INBOX",
					selected: true,
					messages: 1,
				},
			]),
		).toBeNull();
	});

	test("folderMappingsToSizeEstimates maps selected rows", () => {
		expect(
			folderMappingsToSizeEstimates([
				{
					sourcePath: "INBOX",
					destPath: "INBOX",
					selected: true,
					messages: 2,
					bytes: 100,
				},
				{
					sourcePath: "Trash",
					destPath: "Trash",
					selected: false,
					messages: 99,
					bytes: 999,
				},
			]),
		).toEqual([{ path: "INBOX", messages: 2, bytes: 100 }]);
	});
});
