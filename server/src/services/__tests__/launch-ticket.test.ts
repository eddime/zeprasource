import { describe, expect, test } from "bun:test";
import {
	issueMigrationLaunchTicket,
	parseMigrationLaunchTicket,
} from "../launch-ticket";

describe("server launch ticket", () => {
	test("round-trip", () => {
		process.env.LICENSE_SIGNING_SECRET = "test_server_secret";
		const ticket = issueMigrationLaunchTicket({
			stripeSessionId: "cs_srv_1",
			billableGb: 5,
			totalBytes: 7 * 1024 ** 3,
			messageCount: 100,
			folderPathsHash: "abc",
		});
		const payload = parseMigrationLaunchTicket(ticket);
		expect(payload.gb).toBe(5);
		expect(payload.sid).toBe("cs_srv_1");
	});
});
