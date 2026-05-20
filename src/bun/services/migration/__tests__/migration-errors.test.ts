import { describe, expect, test } from "bun:test";
import { classifyMigrationError } from "../migration-errors";

describe("classifyMigrationError", () => {
	test("marks authentication failures as permanent", () => {
		const result = classifyMigrationError(
			Object.assign(new Error("LOGIN failed"), {
				authenticationFailed: true,
				responseText: "AUTHENTICATIONFAILED Invalid credentials",
			}),
		);

		expect(result.kind).toBe("auth");
		expect(result.retryable).toBe(false);
		expect(result.reconnect).toBe(false);
	});

	test("marks quota errors as permanent storage failures", () => {
		const result = classifyMigrationError(
			Object.assign(new Error("Command failed"), {
				responseText: "[OVERQUOTA] Mailbox is full",
				serverResponseCode: "OVERQUOTA",
			}),
		);

		expect(result.kind).toBe("quota");
		expect(result.retryable).toBe(false);
		expect(result.userMessage).toContain("storage");
	});

	test("marks timeouts as retryable transient errors", () => {
		const result = classifyMigrationError(
			Object.assign(new Error("Socket timeout"), { code: "ETIMEOUT" }),
		);

		expect(result.kind).toBe("timeout");
		expect(result.retryable).toBe(true);
		expect(result.reconnect).toBe(false);
	});

	test("marks socket closures as retryable reconnect errors", () => {
		const result = classifyMigrationError(new Error("Socket closed unexpectedly"));

		expect(result.kind).toBe("connection_lost");
		expect(result.retryable).toBe(true);
		expect(result.reconnect).toBe(true);
	});

	test("marks provider throttling as retryable", () => {
		const result = classifyMigrationError(
			Object.assign(new Error("Too many simultaneous connections"), {
				responseText: "[LIMIT] Rate limit exceeded",
			}),
		);

		expect(result.kind).toBe("throttled");
		expect(result.retryable).toBe(true);
		expect(result.userMessage).toContain("slowing");
	});
});
