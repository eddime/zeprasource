/**
 * User-facing migration copy (English). Single source of truth for hero UI and
 * live progress activity labels that must stay in sync.
 */
export const MIGRATION_COPY = {
	idle: {
		headline: "Connect both mailboxes",
		subline: "Link your old inbox and where mail should land — we'll handle the rest.",
	},

	running: {
		headline: "Your zepra is on the move..",
		preparing: "Preparing…",
		connecting: "Connected — starting your move…",
		warmingSubline: "Picking up where we left off…",
		reconnectingSubline: "Reconnecting to your migration…",
		ingestPhase: "Saving your mail locally first…",
		deliverPhase: "Uploading saved mail to your new mailbox…",
	},

	userPaused: {
		headline: "Migration paused",
		hint: "Paused — tap Resume when you're ready",
	},

	enginePaused: {
		headline: "Still finishing up…",
		headlineIdle: "Migration paused",
		hintFallback: "Some messages still need another try — tap Continue",
	},

	retry: {
		sublineFallback: "Taking a short break — still moving your mail",
	},

	completed: {
		headline: "Migration complete",
		headlineCelebration: "Wow! Migration complete.",
	},

	cancelled: {
		headline: "Migration cancelled",
	},

	failed: {
		headline: "Something went wrong",
		headlineFriendly: "Oops — something went wrong.",
		sublineFallback: "Tap Restart to try again",
	},

	buttons: {
		pause: "Pause",
		resume: "Resume",
		continue: "Continue",
		cancelMigration: "Cancel migration",
		restart: "Restart",
	},

	closeGuard: {
		title: "Migration still running",
		message: "Migration is still running — quit anyway?",
		detail:
			"Minimize Zepra (yellow button) to keep the migration running in the background. If you quit, we pause it and resume automatically when you open Zepra again.",
		keepMigrating: "Keep migrating",
		quit: "Quit Zepra",
	},
} as const;

export function messagesProgressLabel(completed: number, total: number): string {
	return `${completed} of ${total} messages`;
}

export function messagesMovedSubline(completed: number, total: number): string {
	if (total > 0) return messagesProgressLabel(completed, total);
	return `${completed} messages moved so far`;
}

export function usuallyTakes(durationHint: string): string {
	return `Usually takes ${durationHint}`;
}
