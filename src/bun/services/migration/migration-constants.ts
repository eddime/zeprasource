/**
 * IMAP migration tuning — one place for throughput vs. reliability tradeoffs.
 *
 * Each migration holds **one** reused source IMAP session and **one** destination session.
 * Folders run sequentially; FETCH/APPEND are pipelined via a bounded queue (profile depth).
 * Batch size ramps via autopilot when transfers stay stable — never extra logins.
 *
 * Provider batch hints come from user-selected mailbox type in `migration-provider-profile.ts`
 * (gmail / outlook / icloud / generic) — not from hostname sniffing.
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
