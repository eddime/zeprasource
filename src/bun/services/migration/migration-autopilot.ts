import type { MigrationErrorClassification } from "./migration-errors";

/** Retryable errors are retried until success or this cap (per message). */
export const MAX_RETRYABLE_ATTEMPTS = 100;

/** Fixed migration behavior — not exposed in the UI. */
export const MIGRATION_TRANSFER_DEFAULTS = {
	skipDuplicates: true,
	preserveFlags: true,
	maxRetryAttempts: MAX_RETRYABLE_ATTEMPTS,
} as const;

export type MigrationTransferConfig = typeof MIGRATION_TRANSFER_DEFAULTS & {
	parallelConnections: number;
};

const MIN_LANES = 1;
const MAX_LANES = 8;
const START_LANES = 3;
const STABLE_BATCHES_TO_GROW = 4;

export type MigrationAutopilotState = {
	laneCount: number;
	stableBatchStreak: number;
};

export function createAutopilotState(): MigrationAutopilotState {
	return { laneCount: START_LANES, stableBatchStreak: 0 };
}

export function recordAutopilotBatchSuccess(state: MigrationAutopilotState): void {
	state.stableBatchStreak += 1;
	if (state.stableBatchStreak >= STABLE_BATCHES_TO_GROW && state.laneCount < MAX_LANES) {
		state.laneCount += 1;
		state.stableBatchStreak = 0;
	}
}

export function recordAutopilotRetry(
	state: MigrationAutopilotState,
	classification: MigrationErrorClassification,
): void {
	state.stableBatchStreak = 0;
	if (
		classification.kind === "throttled" ||
		classification.kind === "timeout" ||
		classification.kind === "connection_lost" ||
		classification.kind === "network"
	) {
		state.laneCount = Math.max(MIN_LANES, state.laneCount - 1);
	}
}

export function getTransferConfig(state: MigrationAutopilotState): MigrationTransferConfig {
	return {
		...MIGRATION_TRANSFER_DEFAULTS,
		parallelConnections: state.laneCount,
	};
}

export function friendlyFolderName(path: string): string {
	const leaf = path.split(/[/.]/).filter(Boolean).pop();
	return leaf && leaf.length > 0 ? leaf : path;
}

export function describeScanningActivity(folderPath: string): string {
	return `Checking ${friendlyFolderName(folderPath)}…`;
}

export function describeTransferActivity(folderPath: string): string {
	return `Moving ${friendlyFolderName(folderPath)}…`;
}

export function describeRetryActivity(
	classification: MigrationErrorClassification,
	retryAfterMs: number,
): string {
	const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
	switch (classification.kind) {
		case "throttled":
			return `Your provider asked us to slow down — continuing in ${seconds}s`;
		case "connection_lost":
		case "network":
			return `Connection hiccup — reconnecting in ${seconds}s`;
		case "timeout":
			return `Server was slow — trying again in ${seconds}s`;
		default:
			return `Quick pause — continuing in ${seconds}s`;
	}
}

export function describeFinishingRemainingActivity(): string {
	return "Making sure every message arrives…";
}

/** Only shown when failures are permanent (quota/auth), not transient. */
export function describeCompletionSummary(messagesFailed: number): string | undefined {
	if (messagesFailed <= 0) return undefined;
	if (messagesFailed === 1) {
		return "One message could not be moved — check destination storage or login.";
	}
	return `${messagesFailed} messages could not be moved — check destination storage or login.`;
}
