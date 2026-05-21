import type { MailAccessProtocol } from "./mail-access";

export type MailboxProvider = "generic" | "gmail" | "outlook" | "icloud";

export type AuthMethod = "password";

export interface MailboxCredentials {
	provider: MailboxProvider;
	email: string;
	host: string;
	port: number;
	secure: boolean;
	authMethod: AuthMethod;
	/** Set by autodiscovery — not shown in UI. Defaults to IMAP. */
	accessProtocol?: MailAccessProtocol;
	username?: string;
	password?: string;
}

export interface ImapFolder {
	path: string;
	name: string;
	delimiter: string;
	attributes: string[];
	messageCount?: number;
}

export interface ConnectionTestResult {
	success: boolean;
	error?: string;
	folders?: ImapFolder[];
}

export type MigrationJobType = "migrate" | "backup";

export type MigrationStatus =
	| "pending"
	| "running"
	| "paused"
	| "completed"
	| "failed"
	| "cancelled";

export interface MigrationProgress {
	migrationId: string;
	status: MigrationStatus;
	/** Live estimate from progress, e.g. "~45 minutes left". */
	remainingDurationLabel?: string;
	currentFolder?: string;
	activityPhase?:
		| "connecting"
		| "scanning"
		| "indexing"
		| "transferring"
		| "retrying"
		| "throttled"
		| "reconnecting";
	activityLabel?: string;
	retryAfterMs?: number;
	/** ISO timestamp when the current retry backoff ends (for live UI countdown). */
	retryEndsAt?: string;
	foldersTotal: number;
	foldersCompleted: number;
	messagesTotal: number;
	messagesCompleted: number;
	messagesFailed: number;
	bytesTransferred: number;
	currentMessage?: string;
	error?: string;
	/** True when the user tapped Pause (not engine failure-pause). */
	userInitiatedPause?: boolean;
	startedAt?: string;
	updatedAt: string;
}

export interface MigrationRecord {
	id: string;
	sourceEmail: string;
	destEmail: string;
	jobType?: MigrationJobType;
	status: MigrationStatus;
	foldersTotal: number;
	foldersCompleted: number;
	messagesTotal: number;
	messagesCompleted: number;
	messagesFailed: number;
	bytesTransferred: number;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	error?: string;
}

export interface AppSettings {
	theme: "system" | "light" | "dark";
	telemetryEnabled: boolean;
	/** Last parent directory chosen for optional local .eml backup. */
	lastBackupParentDir?: string;
	/** Server-signed `zepra_lt.…` license — verified via Zepra Server, not trusted alone. */
	lifetimeLicense?: string;
	/** ISO timestamp of last successful server verification. */
	lifetimeVerifiedAt?: string;
}

export type BackupDiskCheck = {
	ok: boolean;
	path: string;
	freeBytes: number;
	requiredBytes: number;
	summary: string;
};

export interface FolderMapping {
	sourcePath: string;
	destPath: string;
	selected: boolean;
	/** Filled after folder stats are loaded on the selection step. */
	messages?: number;
	bytes?: number;
}

export interface FolderSizeEstimate {
	path: string;
	messages: number;
	bytes: number;
}

export type { MigrationDurationEstimate } from "./migration-duration";

export interface MigrationSizeEstimate {
	totalBytes: number;
	messageCount: number;
	folders: FolderSizeEstimate[];
	requiresPayment: boolean;
	freeLimitBytes: number;
	/** Typical local run time, e.g. "~2 hours". */
	durationLabel: string;
	/** Expectation band, e.g. "about 1–3 hours". */
	durationRangeLabel: string;
	secondsTypical: number;
}

export type {
	DestinationQuotaCheck,
	DestinationQuotaStatus,
} from "./destination-quota";

export const DEFAULT_SETTINGS: AppSettings = {
	theme: "light",
	telemetryEnabled: false,
};

export const PROVIDER_PRESETS: Record<
	MailboxProvider,
	{
		label: string;
		host: string;
		port: number;
		secure: boolean;
		hint?: string;
		hintLink?: { label: string; url: string };
	}
> = {
	generic: {
		label: "Generic IMAP",
		host: "",
		port: 993,
		secure: true,
		hint: "Email + password is enough — we detect the IMAP server automatically.",
	},
	gmail: {
		label: "Gmail",
		host: "imap.gmail.com",
		port: 993,
		secure: true,
		hint: "Use a Google app password (16 characters), not your normal Gmail password.",
		hintLink: {
			label: "Create Google app password",
			url: "https://myaccount.google.com/apppasswords",
		},
	},
	outlook: {
		label: "Outlook / Microsoft 365",
		host: "outlook.office365.com",
		port: 993,
		secure: true,
		hint: "With 2FA enabled, use a Microsoft app password — not your normal account password.",
		hintLink: {
			label: "Create Microsoft app password",
			url: "https://account.live.com/proofs/AppPassword",
		},
	},
	icloud: {
		label: "iCloud Mail",
		host: "imap.mail.me.com",
		port: 993,
		secure: true,
		hint: "Use an app-specific password for IMAP — your normal Apple ID password will not work.",
		hintLink: {
			label: "Create Apple app-specific password",
			url: "https://appleid.apple.com/account/manage/section/security",
		},
	},
};
