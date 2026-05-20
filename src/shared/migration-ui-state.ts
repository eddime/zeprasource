import { MIGRATION_COPY, messagesMovedSubline, usuallyTakes } from "./migration-copy";
import {
	buildProgressLabel,
	isPausedProgress,
	isRetryActivityPhase,
	sanitizeMigrationProgress,
} from "./migration-progress";
import type { MigrationProgress } from "./types";

/** Derived UI phase — the only state HomeView should branch on. */
export type MigrationUiPhase =
	| "idle"
	| "warmingUp"
	| "transferring"
	| "userPaused"
	| "enginePaused"
	| "completed"
	| "cancelled"
	| "failed";

export type MigrationZebraState = "idle" | "running" | "paused" | "success" | "failed";

export interface MigrationUiState {
	phase: MigrationUiPhase;
	canPause: boolean;
	canResume: boolean;
	canContinue: boolean;
	canCancel: boolean;
	canRestart: boolean;
	showHero: boolean;
	showProgressBar: boolean;
	showParticles: boolean;
	showWarmingHint: boolean;
	zebraState: MigrationZebraState;
	headline: string;
	progressLabel: string;
	subline: string;
}

export type MigrationUiContext = {
	pendingAction?: "start" | "resume" | null;
	engineInMemory?: boolean;
	plannedDurationHint?: string | null;
	resumeError?: string | null;
	nowMs?: number;
};

const LIVE_UI_PHASES: MigrationUiPhase[] = ["transferring", "warmingUp"];

export function isLiveUiPhase(phase: MigrationUiPhase): boolean {
	return LIVE_UI_PHASES.includes(phase);
}

const IDLE_UI: MigrationUiState = {
	phase: "idle",
	canPause: false,
	canResume: false,
	canContinue: false,
	canCancel: false,
	canRestart: false,
	showHero: false,
	showProgressBar: false,
	showParticles: false,
	showWarmingHint: false,
	zebraState: "idle",
	headline: MIGRATION_COPY.idle.headline,
	progressLabel: "",
	subline: MIGRATION_COPY.idle.subline,
};

function withUi(overrides: Partial<MigrationUiState>): MigrationUiState {
	return { ...IDLE_UI, ...overrides };
}

function durationSubline(
	progress: MigrationProgress,
	planned: string | null,
): string | null {
	if (progress.remainingDurationLabel) return progress.remainingDurationLabel;
	if (planned) return usuallyTakes(planned);
	return null;
}

export function deriveMigrationUiState(
	progress: MigrationProgress | null | undefined,
	context: MigrationUiContext = {},
): MigrationUiState {
	const {
		pendingAction = null,
		engineInMemory = false,
		plannedDurationHint = null,
		resumeError = null,
		nowMs = Date.now(),
	} = context;

	const p = progress ? sanitizeMigrationProgress(progress) : null;

	if (!p) {
		if (pendingAction) {
			return withUi({
				phase: "warmingUp",
				showHero: true,
				showProgressBar: true,
				showWarmingHint: true,
				canCancel: true,
				zebraState: "running",
				headline: MIGRATION_COPY.running.headline,
				progressLabel: MIGRATION_COPY.running.preparing,
				subline: MIGRATION_COPY.running.warmingSubline,
			});
		}
		return IDLE_UI;
	}

	const progressLabel = buildProgressLabel(p, nowMs);
	const messagesFailed = p.messagesFailed ?? 0;

	if (p.status === "completed") {
		return withUi({
			phase: "completed",
			showHero: true,
			showProgressBar: true,
			zebraState: "success",
			headline: MIGRATION_COPY.completed.headlineCelebration,
			progressLabel,
			subline: p.activityLabel
				? p.activityLabel
				: messagesFailed > 0
					? `${p.messagesCompleted} moved · ${messagesFailed} could not be copied`
					: `${p.messagesCompleted} messages · all moved on your Mac`,
		});
	}

	if (p.status === "cancelled") {
		return withUi({
			phase: "cancelled",
			showHero: true,
			showProgressBar: true,
			zebraState: "idle",
			headline: MIGRATION_COPY.cancelled.headline,
			progressLabel,
			subline: `${p.messagesCompleted} messages moved before you cancelled`,
		});
	}

	if (p.status === "failed") {
		return withUi({
			phase: "failed",
			showHero: true,
			showProgressBar: true,
			canRestart: true,
			zebraState: "failed",
			headline: MIGRATION_COPY.failed.headlineFriendly,
			progressLabel,
			subline: p.error ?? MIGRATION_COPY.failed.sublineFallback,
		});
	}

	if (isPausedProgress(p)) {
		if (p.userInitiatedPause) {
			return withUi({
				phase: "userPaused",
				showHero: true,
				showProgressBar: true,
				canResume: true,
				canCancel: true,
				zebraState: "paused",
				headline: MIGRATION_COPY.userPaused.headline,
				progressLabel,
				subline: resumeError ?? MIGRATION_COPY.userPaused.hint,
			});
		}

		return withUi({
			phase: "enginePaused",
			showHero: true,
			showProgressBar: true,
			canContinue: true,
			canCancel: true,
			zebraState: "paused",
			headline:
				messagesFailed > 0
					? MIGRATION_COPY.enginePaused.headline
					: MIGRATION_COPY.enginePaused.headlineIdle,
			progressLabel,
			subline: p.activityLabel ?? MIGRATION_COPY.enginePaused.hintFallback,
		});
	}

	if (pendingAction === "start" || pendingAction === "resume") {
		return withUi({
			phase: "warmingUp",
			showHero: true,
			showProgressBar: true,
			showWarmingHint: true,
			canCancel: true,
			zebraState: "running",
			headline: MIGRATION_COPY.running.headline,
			progressLabel: progressLabel || MIGRATION_COPY.running.preparing,
			subline: resumeError ?? MIGRATION_COPY.running.warmingSubline,
		});
	}

	if (p.status === "running" && !engineInMemory) {
		return withUi({
			phase: "warmingUp",
			showHero: true,
			showProgressBar: true,
			showWarmingHint: true,
			canContinue: true,
			canCancel: true,
			zebraState: "running",
			headline: MIGRATION_COPY.running.headline,
			progressLabel,
			subline: resumeError ?? MIGRATION_COPY.running.reconnectingSubline,
		});
	}

	if (p.status === "running") {
		const retryBeat = isRetryActivityPhase(p.activityPhase);
		return withUi({
			phase: "transferring",
			showHero: true,
			showProgressBar: true,
			showParticles: true,
			canPause: true,
			canCancel: true,
			zebraState: "running",
			headline: MIGRATION_COPY.running.headline,
			progressLabel,
			subline: retryBeat
				? (p.activityLabel ?? MIGRATION_COPY.retry.sublineFallback)
				: (p.activityLabel ??
					durationSubline(p, plannedDurationHint) ??
					messagesMovedSubline(p.messagesCompleted, p.messagesTotal)),
		});
	}

	return IDLE_UI;
}

export {
	sanitizeMigrationProgress,
	mergeMigrationProgress,
	isTerminalMigrationStatus,
} from "./migration-progress";

export { MIGRATION_COPY };
