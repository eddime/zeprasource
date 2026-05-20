import { describe, expect, test } from "bun:test";
import { computeRetryDelay } from "../retry-policy";

describe("computeRetryDelay", () => {
	test("uses exponential backoff capped at the maximum", () => {
		expect(
			computeRetryDelay(1, {
				baseMs: 500,
				maxMs: 5_000,
				jitterRatio: 0,
			}),
		).toBe(500);
		expect(
			computeRetryDelay(4, {
				baseMs: 500,
				maxMs: 5_000,
				jitterRatio: 0,
			}),
		).toBe(4_000);
		expect(
			computeRetryDelay(8, {
				baseMs: 500,
				maxMs: 5_000,
				jitterRatio: 0,
			}),
		).toBe(5_000);
	});

	test("adds deterministic bounded jitter", () => {
		const delay = computeRetryDelay(2, {
			baseMs: 1_000,
			maxMs: 10_000,
			jitterRatio: 0.2,
			random: () => 1,
		});

		expect(delay).toBe(2_400);
	});
});
