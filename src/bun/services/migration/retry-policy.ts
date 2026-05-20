export type RetryDelayOptions = {
	baseMs?: number;
	maxMs?: number;
	jitterRatio?: number;
	random?: () => number;
};

export function computeRetryDelay(
	attempt: number,
	options: RetryDelayOptions = {},
): number {
	const baseMs = options.baseMs ?? 500;
	const maxMs = options.maxMs ?? 15_000;
	const jitterRatio = options.jitterRatio ?? 0.2;
	const random = options.random ?? Math.random;
	const normalizedAttempt = Math.max(1, attempt);
	const exponential = baseMs * 2 ** (normalizedAttempt - 1);
	const capped = Math.min(maxMs, exponential);
	const jitter = capped * jitterRatio * random();
	return Math.round(Math.min(maxMs, capped + jitter));
}
