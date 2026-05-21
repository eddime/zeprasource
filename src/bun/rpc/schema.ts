import type { RPCSchema } from "electrobun/bun";
import type {
	AppSettings,
	ConnectionTestResult,
	FolderMapping,
	FolderSizeEstimate,
	ImapFolder,
	MailboxCredentials,
	MigrationProgress,
	MigrationRecord,
	MigrationSizeEstimate,
	DestinationQuotaCheck,
	BackupDiskCheck,
} from "../../shared/types";
import type {
	MigrationCheckoutCreateParams,
	MigrationCheckoutCreateResult,
	MigrationCheckoutWaitResult,
} from "../../shared/stripe-checkout";
import type { MigrationPricingCatalog } from "../../shared/migration-pricing-catalog";
import type { ZepraPricingCatalog } from "../../shared/lifetime-pricing-catalog";
import type {
	LifetimeCheckoutCreateResult,
	LifetimeCheckoutWaitResult,
	EntitlementStatus,
} from "../../shared/lifetime-checkout";

export type MailPortRPC = {
	bun: RPCSchema<{
		requests: {
			testConnection: {
				params: { credentials: MailboxCredentials };
				response: ConnectionTestResult;
			};
			discoverImapSettings: {
				params: { email: string; password?: string };
				response: {
					host: string;
					port: number;
					secure: boolean;
					provider: MailboxCredentials["provider"];
					source: "thunderbird" | "autoconfig" | "srv" | "guess";
					verified: boolean;
					accessProtocol: "imap" | "pop3";
				};
			};
			connectMailbox: {
				params: { email: string; password: string };
				response: ConnectionTestResult & {
					host: string;
					port: number;
					secure: boolean;
					provider: MailboxCredentials["provider"];
					accessProtocol: "imap" | "pop3";
					source: "thunderbird" | "autoconfig" | "srv" | "guess";
				};
			};
			prefetchMailDiscovery: {
				params: { email: string };
				response: { started: boolean; domain?: string };
			};
			listFolders: {
				params: { credentials: MailboxCredentials };
				response: ImapFolder[];
			};
			saveMailboxProfile: {
				params: {
					role: "source" | "destination";
					credentials: MailboxCredentials;
				};
				response: { profileId: string };
			};
			getMailboxProfile: {
				params: { role: "source" | "destination" };
				response: MailboxCredentials | null;
			};
			clearMailboxProfiles: {
				params: Record<string, never>;
				response: { success: true };
			};
			estimateMigrationSize: {
				params: {
					source: MailboxCredentials;
					folderPaths: string[];
					destination?: MailboxCredentials;
				};
				response: MigrationSizeEstimate;
			};
			fetchFolderStats: {
				params: {
					source: MailboxCredentials;
					folderPaths: string[];
				};
				response: FolderSizeEstimate[];
			};
			checkDestinationQuota: {
				params: {
					destination: MailboxCredentials;
					requiredBytes: number;
					requiredMessages: number;
				};
				response: DestinationQuotaCheck;
			};
			getDefaultBackupParentDir: {
				params: Record<string, never>;
				response: { defaultPath: string };
			};
			pickBackupDirectory: {
				params: Record<string, never>;
				response: { path: string | null; defaultPath: string };
			};
			checkBackupDiskSpace: {
				params: { parentDir: string; requiredBytes: number };
				response: BackupDiskCheck;
			};
			startMigration: {
				params: {
					source?: MailboxCredentials;
					destination?: MailboxCredentials;
					folderMappings?: FolderMapping[];
					backupRootPath?: string | null;
					jobType?: "migrate" | "backup";
					resumeMigrationId?: string;
					plannedSecondsTypical?: number;
					launchTicket?: string;
				};
				response: { migrationId: string };
			};
			cancelMigration: {
				params: { migrationId: string };
				response: { success: boolean };
			};
			pauseMigration: {
				params: { migrationId: string };
				response: { success: boolean };
			};
			resumeMigration: {
				params: { migrationId: string };
				response: { success: boolean };
			};
			getMigrationProgress: {
				params: { migrationId: string };
				response: MigrationProgress | null;
			};
			listMigrations: {
				params: { limit?: number };
				response: MigrationRecord[];
			};
			getResumableMigrations: {
				params: {};
				response: string[];
			};
			getActiveMigrationIds: {
				params: {};
				response: string[];
			};
			getSettings: {
				params: {};
				response: AppSettings;
			};
			saveSettings: {
				params: { settings: AppSettings };
				response: AppSettings;
			};
			getDataDirectory: {
				params: {};
				response: { path: string };
			};
			checkLocalTestServers: {
				params: {};
				response: { source: boolean; destination: boolean };
			};
			seedLocalTestSource: {
				params: {};
				response: { ok: boolean; error?: string };
			};
			createEtherealTestMailboxes: {
				params: {};
				response: {
					source: MailboxCredentials;
					destination: MailboxCredentials;
				};
			};
			seedEtherealTestSource: {
				params: { credentials: MailboxCredentials };
				response: { ok: boolean; error?: string };
			};
			isStripeConfigured: {
				params: Record<string, never>;
				response: { configured: boolean };
			};
			createMigrationCheckout: {
				params: MigrationCheckoutCreateParams;
				response: MigrationCheckoutCreateResult;
			};
			openMigrationCheckout: {
				params: { checkoutUrl: string; sessionId: string };
				response: { opened: boolean };
			};
			waitForMigrationCheckout: {
				params: { sessionId: string };
				response: MigrationCheckoutWaitResult;
			};
			getMigrationPricingCatalog: {
				params: Record<string, never>;
				response: MigrationPricingCatalog;
			};
			getZepraPricingCatalog: {
				params: Record<string, never>;
				response: ZepraPricingCatalog;
			};
			getEntitlementStatus: {
				params: Record<string, never>;
				response: EntitlementStatus;
			};
			createLifetimeCheckout: {
				params: Record<string, never>;
				response: LifetimeCheckoutCreateResult;
			};
			waitForLifetimeCheckout: {
				params: { sessionId: string };
				response: LifetimeCheckoutWaitResult;
			};
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			migrationProgress: MigrationProgress;
		};
	}>;
};
