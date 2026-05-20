import { describe, expect, test } from "bun:test";
import {
	evaluateDestinationQuota,
	requiredBytesWithBuffer,
} from "../../../../shared/destination-quota";

describe("requiredBytesWithBuffer", () => {
	test("adds minimum buffer for small mailboxes", () => {
		expect(requiredBytesWithBuffer(0)).toBe(50 * 1024 * 1024);
		expect(requiredBytesWithBuffer(1_000)).toBe(50 * 1024 * 1024 + 1_000);
	});

	test("adds 5% for larger mailboxes", () => {
		const bytes = 10 * 1024 * 1024 * 1024;
		expect(requiredBytesWithBuffer(bytes)).toBe(bytes + Math.ceil(bytes * 0.05));
	});
});

describe("evaluateDestinationQuota", () => {
	test("ok when enough storage", () => {
		const result = evaluateDestinationQuota(
			{ storage: { used: 1_000_000_000, limit: 10_000_000_000 } },
			{ bytes: 2_000_000_000, messages: 100 },
		);
		expect(result.status).toBe("ok");
	});

	test("insufficient storage", () => {
		const result = evaluateDestinationQuota(
			{ storage: { used: 9_500_000_000, limit: 10_000_000_000 } },
			{ bytes: 2_000_000_000, messages: 0 },
		);
		expect(result.status).toBe("insufficient_storage");
		expect(result.summary).toContain("Not enough space");
	});

	test("insufficient messages", () => {
		const result = evaluateDestinationQuota(
			{ messages: { used: 98_000, limit: 100_000 } },
			{ bytes: 0, messages: 5_000 },
		);
		expect(result.status).toBe("insufficient_messages");
	});

	test("unsupported when server sends no quota", () => {
		const result = evaluateDestinationQuota({}, { bytes: 1_000, messages: 1 });
		expect(result.status).toBe("unsupported");
	});
});
