import { MIGRATION_COPY } from "./migration-copy";
import type { MigrationProgress, MigrationStatus } from "./types";

const TERMINAL_STATUSES: MigrationStatus[] = ["completed", "cancelled", "failed"];

/** Fields that only apply during an active transfer/retry beat. */
export type TransientActivityFields = Pick<
	MigrationProgress,
	"activityPhase" | "activityLabel" | "retryAfterMs" | "retryEndsAt"
>;

export function isTerminalMigrationStatus(status: MigrationStatus): boolean {
	return TERMINAL_STATUSES.includes(status);
}

export function isRetryActivityPhase(
	phase: MigrationProgress["activityPhase"] | undefined,
): phase is NonNullable<TransientActivityFields["activityPhase"]> {
	return phase === "retrying" || phase === "reconnecting" || phase === "throttled";
}

export function isPausedProgress(progress: MigrationProgress): boolean {
	return progress.status === "paused" || Boolean(progress.userInitiatedPause);
}

export function clearTransientActivity(): TransientActivityFields {
	return {
		activityPhase: undefined,
		activityLabel: undefined,
		retryAfterMs: undefined,
		retryEndsAt: undefined,
	};
}

/** Snapshot extras after the user taps Pause. */
export function userPauseProgressExtras(): Partial<MigrationProgress> {
	return {
		userInitiatedPause: true,
		...clearTransientActivity(),
	};
}

/** Snapshot extras after Resume / cold continue. */
export function runningProgressExtras(): Partial<MigrationProgress> {
	return {
		userInitiatedPause: undefined,
		...clearTransientActivity(),
	};
}

/** Snapshot extras after the user cancels an in-flight migration. */
export function cancelledProgressExtras(): Partial<MigrationProgress> {
	return {
		userInitiatedPause: undefined,
		...clearTransientActivity(),
	};
}

export function buildRetryEndsAt(remainingMs: number): string {
	return new Date(Date.now() + remainingMs).toISOString();
}

function hasTransientActivity(progress: MigrationProgress): boolean {
	return Boolean(
		progress.activityPhase ||
			progress.activityLabel ||
			progress.retryEndsAt ||
			progress.retryAfterMs,
	);
}

/** DB polls omit live activity — keep the in-flight transfer/retry beat. */
export function shouldPreserveTransientActivity(
	prev: MigrationProgress,
	next: MigrationProgress,
): boolean {
	if (prev.status !== "running" || next.status !== "running") return false;
	if (!hasTransientActivity(prev)) return false;
	if (hasTransientActivity(next) && next.activityPhase === prev.activityPhase) {
		return false;
	}
	return !hasTransientActivity(next);
}

export function preserveTransientActivity(
	prev: MigrationProgress,
	next: MigrationProgress,
): MigrationProgress {
	return {
		...next,
		activityPhase: prev.activityPhase,
		activityLabel: prev.activityLabel,
		retryAfterMs: prev.retryAfterMs,
		retryEndsAt: prev.retryEndsAt,
		remainingDurationLabel: prev.remainingDurationLabel ?? next.remainingDurationLabel,
	};
}

/** @deprecated Use shouldPreserveTransientActivity */
export const shouldPreserveTransientRetry = shouldPreserveTransientActivity;

/** @deprecated Use preserveTransientActivity */
export const preserveTransientRetry = preserveTransientActivity;

/** Resume after user pause — running without retry baggage. */
export function isExplicitResume(
	prev: MigrationProgress,
	next: MigrationProgress,
): boolean {
	if (!isPausedProgress(prev)) return false;
	return (
		next.status === "running" &&
		!next.userInitiatedPause &&
		!isRetryActivityPhase(next.activityPhase)
	);
}

/** Ignore out-of-order countdown ticks that would move the deadline backward. */
export function mergeRetryEndsAtMonotonic(
	prevEndsAt: string | undefined,
	nextEndsAt: string | undefined,
): string | undefined {
	if (!prevEndsAt) return nextEndsAt;
	if (!nextEndsAt) return prevEndsAt;
	const prevMs = Date.parse(prevEndsAt);
	const nextMs = Date.parse(nextEndsAt);
	if (!Number.isFinite(prevMs)) return nextEndsAt;
	if (!Number.isFinite(nextMs)) return prevEndsAt;
	return nextMs >= prevMs ? nextEndsAt : prevEndsAt;
}

function reconcileMergedProgress(
	prev: MigrationProgress,
	next: MigrationProgress,
): MigrationProgress {
	if (shouldPreserveTransientActivity(prev, next)) {
		return preserveTransientActivity(prev, next);
	}

	if (
		isRetryActivityPhase(prev.activityPhase) &&
		isRetryActivityPhase(next.activityPhase)
	) {
		return {
			...next,
			retryEndsAt: mergeRetryEndsAtMonotonic(prev.retryEndsAt, next.retryEndsAt),
		};
	}

	return next;
}

/**
 * Normalize server progress for clients. Paused migrations must never carry
 * retry countdown fields (they caused the stuck "continuing in 15s" UI).
 */
export function sanitizeMigrationProgress(progress: MigrationProgress): MigrationProgress {
	if (!isPausedProgress(progress)) return progress;

	return {
		...progress,
		status:
			progress.userInitiatedPause && progress.status === "running"
				? "paused"
				: progress.status,
		...clearTransientActivity(),
	};
}

function isStaleEvent(prev: MigrationProgress, next: MigrationProgress): boolean {
	const prevAt = Date.parse(prev.updatedAt) || 0;
	const nextAt = Date.parse(next.updatedAt) || 0;
	return nextAt < prevAt - 100;
}

/** In-flight running/retry events must not undo a user pause. */
function rejectsRunningAfterUserPause(
	prev: MigrationProgress,
	next: MigrationProgress,
): boolean {
	if (isExplicitResume(prev, next)) return false;
	if (!isPausedProgress(prev)) return false;
	return next.status === "running" && !next.userInitiatedPause;
}

function hasMeaningfulChange(prev: MigrationProgress, next: MigrationProgress): boolean {
	return (
		prev.status !== next.status ||
		prev.userInitiatedPause !== next.userInitiatedPause ||
		prev.messagesCompleted !== next.messagesCompleted ||
		prev.messagesFailed !== next.messagesFailed ||
		prev.activityPhase !== next.activityPhase ||
		prev.retryEndsAt !== next.retryEndsAt ||
		prev.activityLabel !== next.activityLabel
	);
}

/**
 * Merge a live progress event into the cached snapshot. Rejects out-of-order or
 * contradictory events while always allowing countdown and counter updates.
 */
export function mergeMigrationProgress(
	prev: MigrationProgress | undefined,
	incoming: MigrationProgress,
): MigrationProgress {
	const next = sanitizeMigrationProgress(incoming);
	if (!prev || prev.migrationId !== next.migrationId) return next;

	if (isTerminalMigrationStatus(prev.status) && !isTerminalMigrationStatus(next.status)) {
		return prev;
	}
	if (isStaleEvent(prev, next)) return prev;
	if (rejectsRunningAfterUserPause(prev, next)) return prev;
	if (hasMeaningfulChange(prev, next)) {
		return reconcileMergedProgress(prev, next);
	}

	const prevAt = Date.parse(prev.updatedAt) || 0;
	const nextAt = Date.parse(next.updatedAt) || 0;
	const picked = nextAt >= prevAt ? next : prev;
	return reconcileMergedProgress(prev, picked);
}

export function buildProgressLabel(
	progress: MigrationProgress,
	nowMs: number = Date.now(),
): string {
	if (isPausedProgress(progress)) {
		return progress.messagesTotal > 0
			? `${progress.messagesCompleted} of ${progress.messagesTotal} messages`
			: "Paused";
	}

	if (progress.remainingDurationLabel) return progress.remainingDurationLabel;

	if (progress.messagesTotal > 0) {
		return `${progress.messagesCompleted} of ${progress.messagesTotal} messages`;
	}

	if (progress.foldersTotal > 0) {
		return `${progress.foldersCompleted} of ${progress.foldersTotal} folders`;
	}

	return "Preparing…";
}
