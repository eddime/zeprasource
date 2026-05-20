import { describe, expect, test } from "bun:test";
import { normalizeMessageId } from "../../imap/destination-message-index";
import { shardUids } from "../migration-lanes";

describe("migration-lanes", () => {
	test("shardUids distributes round-robin", () => {
		const shards = shardUids([1, 2, 3, 4, 5], 3);
		expect(shards).toEqual([[1, 4], [2, 5], [3]]);
	});

	test("normalizeMessageId strips brackets and lowercases", () => {
		expect(normalizeMessageId("  <ABC@example.com>  ")).toBe("abc@example.com");
	});

	test("concurrent duplicate reservation allows only one claimant", async () => {
		const ids = new Set<string>();
		let chain = Promise.resolve();
		const mutex = {
			run<T>(fn: () => T | Promise<T>): Promise<T> {
				const next = chain.then(fn, fn);
				chain = next.then(
					() => undefined,
					() => undefined,
				);
				return next;
			},
		};

		const key = normalizeMessageId("<dup@test>");
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				mutex.run(() => {
					if (ids.has(key)) return "skip";
					ids.add(key);
					return "claim";
				}),
			),
		);

		expect(results.filter((r) => r === "claim")).toHaveLength(1);
		expect(results.filter((r) => r === "skip")).toHaveLength(7);
	});
});
