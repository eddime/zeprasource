import type { MigrationErrorClassification } from "./migration-errors";
import type { MigrationProviderProfile } from "./migration-provider-profile";

/** Per-message retry cap — enough recovery without hammering servers. */
export const MAX_RETRYABLE_ATTEMPTS = 10;

/** Fixed migration behavior — not exposed in the UI. */
export const MIGRATION_TRANSFER_DEFAULTS = {
	skipDuplicates: true,
	preserveFlags: true,
	maxRetryAttempts: MAX_RETRYABLE_ATTEMPTS,
} as const;

export type MigrationTransferConfig = typeof MIGRATION_TRANSFER_DEFAULTS & {
	/** Always 1: one reused source IMAP session per migration. */
	parallelConnections: 1;
	fetchBatchSize: number;
	fetchByteBudgetBytes: number;
	interBatchPauseMs: number;
	pipelineQueueDepth: number;
	retryDelayDefaults: {
		baseMs: number;
		maxMs: number;
		jitterRatio: number;
	};
};

/** Cap extra pause when throttled (imapsync --maxsleep style). */
export const MAX_THROTTLE_EXTRA_PAUSE_MS = 8_000;

/** Stable run without reconnect/throttle before unlocking modest turbo. */
export const STABILITY_UNLOCK_MS = 10 * 60_000;

export type MigrationAutopilotState = {
	fetchBatchSize: number;
	stableBatchStreak: number;
	/** Added to interBatchPauseMs after throttle errors. */
	throttleExtraPauseMs: number;
	profile: MigrationProviderProfile;
	migrationStartedAt: number;
	lastStabilityBreakerAt: number;
	stabilityUnlocked: boolean;
};

export function createAutopilotState(
	profile: MigrationProviderProfile,
): MigrationAutopilotState {
	const now = Date.now();
	return {
		fetchBatchSize: profile.fetchBatchSize,
		stableBatchStreak: 0,
		throttleExtraPauseMs: 0,
		profile,
		migrationStartedAt: now,
		lastStabilityBreakerAt: now,
		stabilityUnlocked: false,
	};
}

function refreshStabilityUnlock(state: MigrationAutopilotState): void {
	if (state.stabilityUnlocked) return;
	const now = Date.now();
	if (now - state.migrationStartedAt < STABILITY_UNLOCK_MS) return;
	if (now - state.lastStabilityBreakerAt < STABILITY_UNLOCK_MS) return;
	state.stabilityUnlocked = true;
}

function recordStabilityBreaker(state: MigrationAutopilotState): void {
	state.lastStabilityBreakerAt = Date.now();
	state.stabilityUnlocked = false;
}

/** Grow FETCH batch size when stable — never opens extra IMAP logins. */
export function recordAutopilotBatchSuccess(state: MigrationAutopilotState): void {
	const { profile } = state;
	refreshStabilityUnlock(state);
	state.stableBatchStreak += 1;
	if (state.throttleExtraPauseMs > 0) {
		state.throttleExtraPauseMs = Math.max(0, state.throttleExtraPauseMs - 250);
	}
	if (state.stableBatchStreak < profile.stableBatchesToGrow) return;
	if (state.fetchBatchSize >= profile.maxFetchBatchSize) return;
	const step = state.stabilityUnlocked ? 15 : 10;
	state.fetchBatchSize = Math.min(profile.maxFetchBatchSize, state.fetchBatchSize + step);
	state.stableBatchStreak = 0;
}

export function recordAutopilotRetry(
	state: MigrationAutopilotState,
	classification: MigrationErrorClassification,
): void {
	recordStabilityBreaker(state);
	state.stableBatchStreak = 0;
	state.fetchBatchSize = Math.max(
		state.profile.fetchBatchSize,
		Math.floor(state.fetchBatchSize * 0.75),
	);
	if (classification.kind === "throttled") {
		state.throttleExtraPauseMs = Math.min(
			MAX_THROTTLE_EXTRA_PAUSE_MS,
			state.throttleExtraPauseMs + 1_500,
		);
	}
}

export function getTransferConfig(state: MigrationAutopilotState): MigrationTransferConfig {
	const { profile } = state;
	refreshStabilityUnlock(state);
	const throttled = state.throttleExtraPauseMs > 0;
	const turbo = state.stabilityUnlocked && !throttled;
	const basePause = profile.interBatchPauseMs + state.throttleExtraPauseMs;
	return {
		...MIGRATION_TRANSFER_DEFAULTS,
		parallelConnections: 1,
		fetchBatchSize: state.fetchBatchSize,
		fetchByteBudgetBytes: profile.fetchByteBudgetBytes,
		interBatchPauseMs: turbo ? Math.max(20, basePause - 25) : basePause,
		pipelineQueueDepth: throttled
			? Math.max(1, profile.pipelineQueueDepth - 1)
			: turbo
				? Math.min(5, profile.pipelineQueueDepth + 1)
				: profile.pipelineQueueDepth,
		retryDelayDefaults: {
			baseMs: profile.retryBaseMs,
			maxMs: profile.retryMaxMs,
			jitterRatio: 0.15,
		},
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

export function describeIngestActivity(folderPath: string): string {
	return `Saving ${friendlyFolderName(folderPath)} locally…`;
}

export function describeDeliverActivity(folderPath: string): string {
	return `Uploading ${friendlyFolderName(folderPath)} to your new mailbox…`;
}

export function describeDeliverPhaseActivity(): string {
	return "Uploading saved mail to your new mailbox…";
}

export function describeRetryActivity(
	classification: MigrationErrorClassification,
): string {
	switch (classification.kind) {
		case "throttled":
			return "Your provider asked us to slow down — still moving your mail";
		case "connection_lost":
		case "network":
			return "Connection hiccup — reconnecting";
		case "timeout":
			return "Server was slow — trying again";
		default:
			return "Taking a short break — still moving your mail";
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
