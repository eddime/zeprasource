import { describe, expect, test } from "bun:test";
import {
	createAutopilotState,
	describeCompletionSummary,
	describeRetryActivity,
	getTransferConfig,
	recordAutopilotBatchSuccess,
	recordAutopilotRetry,
} from "../migration-autopilot";
import type { MigrationErrorClassification } from "../migration-errors";

describe("migration-autopilot", () => {
	test("starts with two lanes and grows after stable batches", () => {
		const state = createAutopilotState();
		expect(getTransferConfig(state).parallelConnections).toBe(2);
		for (let i = 0; i < 5; i++) recordAutopilotBatchSuccess(state);
		expect(getTransferConfig(state).parallelConnections).toBe(2);
		recordAutopilotBatchSuccess(state);
		expect(getTransferConfig(state).parallelConnections).toBe(3);
	});

	test("backs off one lane after provider pressure", () => {
		const state = createAutopilotState();
		for (let i = 0; i < 6; i++) recordAutopilotBatchSuccess(state);
		expect(getTransferConfig(state).parallelConnections).toBe(3);
		const throttled: MigrationErrorClassification = {
			kind: "throttled",
			retryable: true,
			reconnect: false,
			userMessage: "",
		};
		recordAutopilotRetry(state, throttled);
		expect(getTransferConfig(state).parallelConnections).toBe(2);
	});

	test("completion summary only when needed", () => {
		expect(describeCompletionSummary(0)).toBeUndefined();
		expect(describeCompletionSummary(1)).toContain("One message");
		expect(describeCompletionSummary(4)).toContain("4 messages");
	});

	test("retry activity is user-facing not technical", () => {
		const text = describeRetryActivity({
			kind: "throttled",
			retryable: true,
			reconnect: false,
			userMessage: "",
		});
		expect(text).toContain("slow down");
		expect(text).not.toContain("throttl");
	});
});
