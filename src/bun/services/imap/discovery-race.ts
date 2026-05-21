export type LoginProbeResult = "ok" | "auth-failed" | "network";

export interface StreamingRaceOptions<T> {
	maxConcurrency: number;
	budgetMs: number;
	probe: (candidate: T) => Promise<LoginProbeResult>;
	candidateKey: (candidate: T) => string;
}

/**
 * Probe candidates as they arrive; first "ok" wins, else first "auth-failed" after stream ends.
 */
export function createStreamingRace<T>(options: StreamingRaceOptions<T>): {
	enqueue: (candidate: T) => void;
	close: () => void;
	wait: () => Promise<T | null>;
} {
	const { maxConcurrency, budgetMs, probe, candidateKey } = options;
	const seen = new Set<string>();
	const pending: T[] = [];
	let inFlight = 0;
	let streamClosed = false;
	let settled = false;
	let okWinner: T | null = null;
	let authFallback: T | null = null;
	let finishResolve: ((value: T | null) => void) | null = null;

	const budgetTimer = setTimeout(() => {
		streamClosed = true;
		tryFinish();
	}, budgetMs);

	function tryFinish() {
		if (settled) return;
		if (okWinner) {
			settled = true;
			clearTimeout(budgetTimer);
			finishResolve?.(okWinner);
			finishResolve = null;
			return;
		}
		if (streamClosed && inFlight === 0 && pending.length === 0) {
			settled = true;
			clearTimeout(budgetTimer);
			finishResolve?.(authFallback);
			finishResolve = null;
		}
	}

	function onProbeDone(candidate: T, result: LoginProbeResult) {
		inFlight--;
		if (settled) return;
		if (result === "ok") {
			okWinner = candidate;
			tryFinish();
			return;
		}
		if (result === "auth-failed" && !authFallback) {
			authFallback = candidate;
		}
		drain();
		tryFinish();
	}

	function drain() {
		while (!settled && !okWinner && inFlight < maxConcurrency && pending.length > 0) {
			const candidate = pending.shift()!;
			inFlight++;
			probe(candidate)
				.then((result) => onProbeDone(candidate, result))
				.catch(() => onProbeDone(candidate, "network"));
		}
		tryFinish();
	}

	return {
		enqueue(candidate: T) {
			if (settled || okWinner) return;
			const key = candidateKey(candidate);
			if (seen.has(key)) return;
			seen.add(key);
			pending.push(candidate);
			drain();
		},
		close() {
			streamClosed = true;
			tryFinish();
		},
		wait() {
			if (settled) return Promise.resolve(okWinner ?? authFallback);
			return new Promise<T | null>((resolve) => {
				finishResolve = resolve;
				tryFinish();
			});
		},
	};
}
