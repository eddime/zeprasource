import { describe, expect, test } from "bun:test";
import {
	createAutopilotState,
	describeCompletionSummary,
	describeRetryActivity,
	getTransferConfig,
	recordAutopilotBatchSuccess,
	recordAutopilotRetry,
	STABILITY_UNLOCK_MS,
} from "../migration-autopilot";
import type { MigrationErrorClassification } from "../migration-errors";
import { resolveMigrationProviderProfile } from "../migration-provider-profile";
import type { MailboxCredentials } from "../../../../shared/types";

const genericProfile = resolveMigrationProviderProfile(
	{
		provider: "generic",
		email: "a@test.com",
		host: "mail.example.com",
		port: 993,
		secure: true,
		authMethod: "password",
		accessProtocol: "imap",
	} satisfies MailboxCredentials,
	{
		provider: "generic",
		email: "b@test.com",
		host: "mail2.example.com",
		port: 993,
		secure: true,
		authMethod: "password",
		accessProtocol: "imap",
	} satisfies MailboxCredentials,
	false,
);

describe("migration-autopilot", () => {
	test("always uses one source connection; grows batch size when stable", () => {
		const state = createAutopilotState(genericProfile);
		expect(getTransferConfig(state).parallelConnections).toBe(1);
		const initialBatch = getTransferConfig(state).fetchBatchSize;
		for (let i = 0; i < genericProfile.stableBatchesToGrow - 1; i++) {
			recordAutopilotBatchSuccess(state);
		}
		expect(getTransferConfig(state).fetchBatchSize).toBe(initialBatch);
		recordAutopilotBatchSuccess(state);
		expect(getTransferConfig(state).fetchBatchSize).toBeGreaterThan(initialBatch);
	});

	test("adds throttle pause and shrinks pipeline on provider pressure", () => {
		const state = createAutopilotState(genericProfile);
		const throttled: MigrationErrorClassification = {
			kind: "throttled",
			retryable: true,
			reconnect: false,
			userMessage: "",
		};
		recordAutopilotRetry(state, throttled);
		const cfg = getTransferConfig(state);
		expect(cfg.interBatchPauseMs).toBeGreaterThan(genericProfile.interBatchPauseMs);
		expect(cfg.pipelineQueueDepth).toBeLessThan(genericProfile.pipelineQueueDepth);
	});

	test("completion summary only when needed", () => {
		expect(describeCompletionSummary(0)).toBeUndefined();
		expect(describeCompletionSummary(1)).toContain("One message");
		expect(describeCompletionSummary(4)).toContain("4 messages");
	});

	test("unlocks turbo after stable period without reconnect/throttle", () => {
		const state = createAutopilotState(genericProfile);
		state.migrationStartedAt = Date.now() - STABILITY_UNLOCK_MS - 1;
		state.lastStabilityBreakerAt = Date.now() - STABILITY_UNLOCK_MS - 1;
		recordAutopilotBatchSuccess(state);
		const cfg = getTransferConfig(state);
		expect(state.stabilityUnlocked).toBe(true);
		expect(cfg.pipelineQueueDepth).toBeGreaterThan(genericProfile.pipelineQueueDepth);
		expect(cfg.interBatchPauseMs).toBeLessThan(genericProfile.interBatchPauseMs);
	});

	test("reconnect resets stability unlock", () => {
		const state = createAutopilotState(genericProfile);
		state.stabilityUnlocked = true;
		recordAutopilotRetry(state, {
			kind: "connection_lost",
			retryable: true,
			reconnect: true,
			userMessage: "",
		});
		expect(state.stabilityUnlocked).toBe(false);
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
