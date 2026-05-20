import { describe, expect, test } from "bun:test";
import {
	estimateMigrationDuration,
	estimateRemainingDuration,
	formatDurationCompact,
	formatDurationLabel,
} from "../migration-duration";

const gb = (n: number) => n * 1024 ** 3;

describe("estimateMigrationDuration", () => {
	test("small mailbox is minutes not hours", () => {
		const d = estimateMigrationDuration({
			totalBytes: 50 * 1024 ** 2,
			messageCount: 500,
			sourceProvider: "gmail",
			destProvider: "outlook",
		});
		expect(d.secondsTypical).toBeLessThan(3600);
		expect(d.label).toMatch(/minute/);
	});

	test("large mailbox trends toward hours", () => {
		const d = estimateMigrationDuration({
			totalBytes: gb(8),
			messageCount: 40_000,
			sourceProvider: "gmail",
			destProvider: "gmail",
		});
		expect(d.secondsTypical).toBeGreaterThan(3600);
		expect(d.label).toMatch(/hour/);
		expect(d.rangeLabel).toContain("–");
	});

	test("gmail is slower than generic at same size", () => {
		const gmail = estimateMigrationDuration({
			totalBytes: gb(2),
			messageCount: 10_000,
			sourceProvider: "gmail",
			destProvider: "gmail",
		});
		const generic = estimateMigrationDuration({
			totalBytes: gb(2),
			messageCount: 10_000,
			sourceProvider: "generic",
			destProvider: "generic",
		});
		expect(gmail.secondsTypical).toBeGreaterThan(generic.secondsTypical);
	});
});

describe("formatDurationLabel", () => {
	test("prefixes with tilde", () => {
		expect(formatDurationLabel(7200)).toBe("~2 hours");
	});
});

describe("formatDurationCompact", () => {
	test("formats minutes for button", () => {
		expect(formatDurationCompact(90)).toBe("2 min");
	});
});

describe("estimateRemainingDuration", () => {
	test("needs enough progress before showing", () => {
		expect(
			estimateRemainingDuration({
				elapsedSeconds: 60,
				messagesCompleted: 1,
				messagesTotal: 100,
			}),
		).toBeUndefined();
	});

	test("returns left label when rate is known", () => {
		const label = estimateRemainingDuration({
			elapsedSeconds: 100,
			messagesCompleted: 50,
			messagesTotal: 100,
		});
		expect(label).toMatch(/left$/);
	});

	test("stays near preflight plan at 67% progress", () => {
		const label = estimateRemainingDuration({
			elapsedSeconds: 40,
			messagesCompleted: 67,
			messagesTotal: 100,
			plannedSecondsTypical: 90,
		});
		expect(label).toBeDefined();
		expect(label).not.toMatch(/hours/);
	});
});
