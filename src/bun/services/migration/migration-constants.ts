/**
 * IMAP migration tuning — one place for throughput vs. reliability tradeoffs.
 *
 * Provider reference (per mailbox account, approximate):
 * - Gmail / Google Workspace: ~15 concurrent IMAP sessions
 * - Microsoft 365 / Outlook: ~15–20 (plus opaque “request throttled” budgets)
 * - Yahoo, iCloud, Fastmail: often ~10–15
 * - Shared hosting (DreamHost, IONOS, Hostinger, …): often stricter; 4–8 sessions
 *
 * Each parallel lane holds one IMAP session to the source and one to the destination,
 * so load on one side ≈ `parallelConnections` (we cap at 4 → safe vs. Gmail’s 15).
 *
 * imapsync (common baseline) runs mostly serial per folder with `--maxsleep 2` and
 * optional `--maxbytespersecond`; we use modest parallelism + autopilot ramp instead.
 */

/** UIDs per FETCH during transfer — balance burst size vs. server tolerance. */
export const MIGRATION_FETCH_BATCH_SIZE = 50;

/** Per-message append/fetch timeout (large attachments on slow hosts). */
export const MESSAGE_TRANSFER_TIMEOUT_MS = 120_000;

/** Default backoff for retryable IMAP errors. */
export const MIGRATION_RETRY_DELAY_DEFAULTS = {
	baseMs: 1_000,
	maxMs: 20_000,
	jitterRatio: 0.15,
} as const;

/** Pause between successful FETCH batches — brief breathing room for shared hosts. */
export const INTER_BATCH_PAUSE_MS = 60;

/** Pause between failure-sweep passes. */
export const FAILURE_SWEEP_BASE_DELAY_MS = 3_000;

/** Parallel IMAP lanes (connections per side = lane count). */
export const MIGRATION_PARALLEL = {
	minLanes: 1,
	startLanes: 2,
	maxLanes: 4,
	/** Successful batches before trying +1 lane (only while below maxLanes). */
	stableBatchesToGrow: 6,
} as const;
