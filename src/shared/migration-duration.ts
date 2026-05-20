import type { MailboxProvider } from "./types";

/** Conservative effective throughput (bytes/s) for IMAP→IMAP on real providers. */
const PROVIDER_BYTES_PER_SECOND: Record<MailboxProvider, number> = {
	gmail: 550_000,
	outlook: 750_000,
	icloud: 650_000,
	generic: 900_000,
};

/** Per-message overhead (fetch + append + flags) in seconds. */
const SECONDS_PER_MESSAGE = 0.09;

/** Buffer for retries, throttling, folder scans. */
const DURATION_BUFFER = 1.25;
const MIN_FACTOR = 0.7;
const MAX_FACTOR = 1.75;

export type MigrationDurationEstimate = {
	secondsTypical: number;
	secondsMin: number;
	secondsMax: number;
	/** Single friendly line, e.g. "~2 hours". */
	label: string;
	/** Band for expectations, e.g. "about 1–3 hours". */
	rangeLabel: string;
};

function effectiveBytesPerSecond(
	sourceProvider: MailboxProvider,
	destProvider: MailboxProvider,
): number {
	return Math.min(
		PROVIDER_BYTES_PER_SECOND[sourceProvider],
		PROVIDER_BYTES_PER_SECOND[destProvider],
	);
}

function rawTransferSeconds(
	totalBytes: number,
	messageCount: number,
	sourceProvider: MailboxProvider,
	destProvider: MailboxProvider,
): number {
	const bps = effectiveBytesPerSecond(sourceProvider, destProvider);
	const transfer = totalBytes > 0 ? totalBytes / bps : 0;
	const overhead = messageCount * SECONDS_PER_MESSAGE;
	const scanSetup = messageCount > 0 ? Math.min(600, 30 + messageCount * 0.02) : 15;
	return (transfer + overhead + scanSetup) * DURATION_BUFFER;
}

function roundMinutesUp(minutes: number): number {
	if (minutes < 5) return 5;
	if (minutes < 60) return Math.ceil(minutes / 5) * 5;
	return Math.ceil(minutes / 15) * 15;
}

function roundHours(value: number): number {
	if (value < 1) return 0.5;
	if (value < 6) return Math.ceil(value * 2) / 2;
	return Math.ceil(value);
}

export function formatDurationSeconds(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "under a minute";
	if (seconds < 90) return "about 1 minute";
	if (seconds < 3600) {
		const minutes = roundMinutesUp(seconds / 60);
		return minutes === 1 ? "about 1 minute" : `about ${minutes} minutes`;
	}
	if (seconds < 86_400) {
		const hours = roundHours(seconds / 3600);
		return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
	}
	const days = Math.max(1, Math.ceil(seconds / 86_400));
	return days === 1 ? "about 1 day" : `about ${days} days`;
}

export function formatDurationLabel(seconds: number): string {
	const inner = formatDurationSeconds(seconds).replace(/^about /, "");
	if (seconds < 3600) return `~${inner}`;
	return `~${inner}`;
}

export function formatDurationRange(secondsMin: number, secondsMax: number): string {
	if (secondsMax < 120) return "under a few minutes";
	const minLabel = formatDurationSeconds(secondsMin).replace(/^about /, "");
	const maxLabel = formatDurationSeconds(secondsMax).replace(/^about /, "");
	if (minLabel === maxLabel) return `about ${minLabel}`;
	return `about ${minLabel}–${maxLabel}`;
}

export function estimateMigrationDuration(input: {
	totalBytes: number;
	messageCount: number;
	sourceProvider?: MailboxProvider;
	destProvider?: MailboxProvider;
}): MigrationDurationEstimate {
	const source = input.sourceProvider ?? "generic";
	const dest = input.destProvider ?? "generic";
	const typical = rawTransferSeconds(input.totalBytes, input.messageCount, source, dest);
	const secondsTypical = Math.max(30, Math.round(typical));
	const secondsMin = Math.max(20, Math.round(secondsTypical * MIN_FACTOR));
	const secondsMax = Math.max(secondsMin + 30, Math.round(secondsTypical * MAX_FACTOR));

	return {
		secondsTypical,
		secondsMin,
		secondsMax,
		label: formatDurationLabel(secondsTypical),
		rangeLabel: formatDurationRange(secondsMin, secondsMax),
	};
}

/** Short label for buttons, e.g. "1 min", "2 hours". */
export function formatDurationCompact(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "1 min";
	if (seconds < 60) return "1 min";
	if (seconds < 3600) {
		const minutes = Math.max(1, Math.ceil(seconds / 60));
		return minutes === 1 ? "1 min" : `${minutes} min`;
	}
	if (seconds < 86_400) {
		const hours = roundHours(seconds / 3600);
		return hours === 1 ? "1 hour" : `${hours} hours`;
	}
	const days = Math.max(1, Math.ceil(seconds / 86_400));
	return days === 1 ? "1 day" : `${days} days`;
}

/** Live remaining time — blends plan from preflight with measured rate (avoids wild ETAs). */
export function estimateRemainingDuration(input: {
	elapsedSeconds: number;
	messagesCompleted: number;
	messagesTotal: number;
	plannedSecondsTypical?: number;
}): string | undefined {
	const { elapsedSeconds, messagesCompleted, messagesTotal, plannedSecondsTypical } = input;
	if (messagesTotal <= messagesCompleted) return undefined;

	const progress = messagesCompleted / messagesTotal;
	let remainingSeconds: number | undefined;

	const planRemaining =
		plannedSecondsTypical && plannedSecondsTypical > 0
			? Math.max(20, plannedSecondsTypical * Math.max(0, 1 - progress))
			: undefined;

	if (planRemaining !== undefined) {
		remainingSeconds = planRemaining;
	}

	if (messagesCompleted >= 8 && elapsedSeconds >= 20) {
		const rate = messagesCompleted / elapsedSeconds;
		const liveRemaining = (messagesTotal - messagesCompleted) / rate;
		if (remainingSeconds === undefined) {
			remainingSeconds = liveRemaining;
		} else {
			const blend = Math.min(1, Math.max(0, (progress - 0.25) / 0.5));
			remainingSeconds = remainingSeconds * (1 - blend) + liveRemaining * blend;
			if (planRemaining !== undefined) {
				remainingSeconds = Math.min(remainingSeconds, planRemaining * 2.5);
			}
		}
	}

	if (remainingSeconds === undefined || remainingSeconds < 10) return undefined;
	return `${formatDurationLabel(remainingSeconds)} left`;
}
