import { afterEach, describe, expect, test } from "bun:test";
import {
	issueMigrationLaunchTicket,
	parseMigrationLaunchTicket,
} from "../launch-ticket";

const PREV = process.env.ZEPRA_LICENSE_SIGNING_SECRET;

afterEach(() => {
	if (PREV === undefined) {
		delete process.env.ZEPRA_LICENSE_SIGNING_SECRET;
	} else {
		process.env.ZEPRA_LICENSE_SIGNING_SECRET = PREV;
	}
});

describe("launch-ticket", () => {
	test("issues and verifies a ticket", () => {
		process.env.ZEPRA_LICENSE_SIGNING_SECRET =
			"test-signing-secret-min-32-chars!!";

		const ticket = issueMigrationLaunchTicket({
			stripeSessionId: "cs_test_123",
			tierId: "plus",
			totalBytes: 12_000_000_000,
			messageCount: 42,
			folderPathsHash: "abc123",
			expiresAtMs: Date.now() + 60_000,
		});

		const payload = parseMigrationLaunchTicket(ticket);
		expect(payload.sid).toBe("cs_test_123");
		expect(payload.tier).toBe("plus");
		expect(payload.bytes).toBe(12_000_000_000);
	});
});
