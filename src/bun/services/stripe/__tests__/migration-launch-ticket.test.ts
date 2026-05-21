import { afterEach, describe, expect, test } from "bun:test";
import {
	issueMigrationLaunchTicket,
	parseMigrationLaunchTicket,
} from "../migration-launch-ticket";

const prior = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
	if (prior === undefined) delete process.env.STRIPE_SECRET_KEY;
	else process.env.STRIPE_SECRET_KEY = prior;
});

describe("migration launch ticket", () => {
	test("round-trip with valid signature", () => {
		process.env.STRIPE_SECRET_KEY = "sk_test_launch_ticket_secret";
		const ticket = issueMigrationLaunchTicket({
			stripeSessionId: "cs_test_123",
			billableGb: 8,
			totalBytes: 12_000_000_000,
			messageCount: 42_000,
			folderPathsHash: "abc123",
			expiresAtMs: Date.now() + 60_000,
		});

		expect(ticket.startsWith("zepra1.")).toBe(true);

		const payload = parseMigrationLaunchTicket(ticket);
		expect(payload.sid).toBe("cs_test_123");
		expect(payload.gb).toBe(8);
		expect(payload.bytes).toBe(12_000_000_000);
	});

	test("rejects tampered signature", () => {
		process.env.STRIPE_SECRET_KEY = "sk_test_launch_ticket_secret";
		const ticket = issueMigrationLaunchTicket({
			stripeSessionId: "cs_test_123",
			billableGb: 1,
			totalBytes: 3_000_000_000,
			messageCount: 1000,
			folderPathsHash: "hash",
			expiresAtMs: Date.now() + 60_000,
		});

		const parts = ticket.split(".");
		parts[2] = `${parts[2]}x`;
		expect(() => parseMigrationLaunchTicket(parts.join("."))).toThrow(
			/signature/i,
		);
	});
});
