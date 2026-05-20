import { describe, expect, test } from "bun:test";
import {
	mergeMigrationProgress,
	sanitizeMigrationProgress,
} from "../migration-progress";
import { deriveMigrationUiState } from "../migration-ui-state";
import type { MigrationProgress } from "../types";

function base(overrides: Partial<MigrationProgress> = {}): MigrationProgress {
	return {
		migrationId: "m1",
		status: "running",
		foldersTotal: 2,
		foldersCompleted: 0,
		messagesTotal: 100,
		messagesCompleted: 10,
		messagesFailed: 0,
		bytesTransferred: 0,
		updatedAt: "2026-05-20T12:00:00.000Z",
		...overrides,
	};
}

describe("migration-progress", () => {
	test("sanitize clears retry fields when user paused", () => {
		const out = sanitizeMigrationProgress(
			base({
				status: "paused",
				userInitiatedPause: true,
				activityPhase: "retrying",
				retryAfterMs: 15_000,
				retryEndsAt: new Date().toISOString(),
			}),
		);
		expect(out.activityPhase).toBeUndefined();
		expect(out.retryAfterMs).toBeUndefined();
		expect(out.retryEndsAt).toBeUndefined();
	});

	test("merge rejects running retry after user pause", () => {
		const prev = base({
			status: "paused",
			userInitiatedPause: true,
			updatedAt: "2026-05-20T12:00:01.000Z",
		});
		const incoming = base({
			status: "running",
			activityPhase: "retrying",
			retryAfterMs: 15_000,
			retryEndsAt: new Date(Date.now() + 15_000).toISOString(),
			activityLabel: "Taking a short break — still moving your mail",
			updatedAt: "2026-05-20T12:00:05.000Z",
		});
		const out = mergeMigrationProgress(prev, incoming);
		expect(out.status).toBe("paused");
		expect(out.userInitiatedPause).toBe(true);
		expect(out.activityPhase).toBeUndefined();
	});

	test("merge accepts explicit resume after user pause", () => {
		const prev = base({
			status: "paused",
			userInitiatedPause: true,
			messagesCompleted: 35,
			updatedAt: "2026-05-20T12:00:10.000Z",
		});
		const incoming = base({
			status: "running",
			messagesCompleted: 35,
			activityPhase: "transferring",
			activityLabel: "Moving Inbox…",
			updatedAt: "2026-05-20T12:00:11.000Z",
		});
		const out = mergeMigrationProgress(prev, incoming);
		expect(out.status).toBe("running");
		expect(out.userInitiatedPause).toBeUndefined();
	});

	test("merge accepts resume with newer timestamp", () => {
		const prev = base({
			status: "paused",
			userInitiatedPause: true,
			updatedAt: "2026-05-20T12:00:01.000Z",
		});
		const incoming = base({
			status: "running",
			activityPhase: "transferring",
			updatedAt: "2026-05-20T12:00:05.000Z",
		});
		const out = mergeMigrationProgress(prev, incoming);
		expect(out.status).toBe("running");
		expect(out.userInitiatedPause).toBeUndefined();
	});
});

describe("deriveMigrationUiState", () => {
	test("user pause shows resume", () => {
		const ui = deriveMigrationUiState(
			base({ status: "paused", userInitiatedPause: true }),
		);
		expect(ui.phase).toBe("userPaused");
		expect(ui.canResume).toBe(true);
		expect(ui.canPause).toBe(false);
	});

	test("retry keeps transferring UI with static subline and message progress", () => {
		const ui = deriveMigrationUiState(
			base({
				activityPhase: "throttled",
				activityLabel: "Your provider asked us to slow down — still moving your mail",
			}),
			{ engineInMemory: true },
		);
		expect(ui.phase).toBe("transferring");
		expect(ui.canPause).toBe(true);
		expect(ui.progressLabel).toBe("10 of 100 messages");
		expect(ui.subline).toContain("slow down");
	});

	test("engine paused shows continue", () => {
		const ui = deriveMigrationUiState(base({ status: "paused", messagesFailed: 3 }));
		expect(ui.phase).toBe("enginePaused");
		expect(ui.canContinue).toBe(true);
	});

	test("merge keeps retry activity when DB poll strips transient fields", () => {
		const ends = new Date(Date.now() + 10_000).toISOString();
		const prev = base({
			activityPhase: "retrying",
			activityLabel: "Taking a short break — still moving your mail",
			retryEndsAt: ends,
			updatedAt: "2026-05-20T12:00:01.000Z",
		});
		const polled = base({
			updatedAt: "2026-05-20T12:00:04.000Z",
			messagesCompleted: 36,
		});
		const out = mergeMigrationProgress(prev, polled);
		expect(out.activityPhase).toBe("retrying");
		expect(out.retryEndsAt).toBe(ends);
		expect(out.messagesCompleted).toBe(36);
	});

	test("merge rejects second stale running tick after pause", () => {
		const prev = base({
			status: "paused",
			userInitiatedPause: true,
			updatedAt: "2026-05-20T12:00:20.000Z",
		});
		const secondStale = base({
			status: "running",
			activityPhase: "retrying",
			activityLabel: "Taking a short break — still moving your mail",
			retryEndsAt: new Date(Date.now() + 2_000).toISOString(),
			updatedAt: "2026-05-20T12:00:25.000Z",
		});
		expect(mergeMigrationProgress(prev, secondStale).status).toBe("paused");
	});

	test("merge ignores backward retryEndsAt ticks", () => {
		const later = new Date(Date.now() + 8_000).toISOString();
		const earlier = new Date(Date.now() + 2_000).toISOString();
		const prev = base({
			activityPhase: "retrying",
			retryEndsAt: later,
			updatedAt: "2026-05-20T12:00:02.000Z",
		});
		const staleTick = base({
			activityPhase: "retrying",
			retryEndsAt: earlier,
			activityLabel: "Taking a short break — still moving your mail",
			updatedAt: "2026-05-20T12:00:02.500Z",
		});
		expect(mergeMigrationProgress(prev, staleTick).retryEndsAt).toBe(later);
	});
});
