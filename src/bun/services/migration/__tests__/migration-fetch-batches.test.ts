import { describe, expect, test } from "bun:test";
import { buildUidBatchesByByteBudget } from "../migration-fetch-batches";

describe("migration-fetch-batches", () => {
	test("splits by byte budget and respects max count", () => {
		const items = [
			{ uid: 1, sizeBytes: 1_000_000 },
			{ uid: 2, sizeBytes: 1_000_000 },
			{ uid: 3, sizeBytes: 1_000_000 },
			{ uid: 4, sizeBytes: 500_000 },
		];
		const batches = buildUidBatchesByByteBudget(items, 2_500_000, 30);
		expect(batches).toEqual([[1, 2], [3, 4]]);
	});

	test("uses unknown size fallback for missing sizes", () => {
		const items = [{ uid: 1 }, { uid: 2 }];
		const batches = buildUidBatchesByByteBudget(items, 300_000, 30);
		expect(batches).toHaveLength(2);
		expect(batches[0]).toEqual([1]);
	});
});
