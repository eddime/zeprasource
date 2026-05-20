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
} from "../../shared/types";
import type {
	MigrationCheckoutCreateParams,
	MigrationCheckoutCreateResult,
	MigrationCheckoutWaitResult,
} from "../../shared/stripe-checkout";
import type { MigrationPricingCatalog } from "../../shared/migration-pricing-catalog";

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
					source:
						| "preset"
						| "thunderbird"
						| "autoconfig"
						| "srv"
						| "mx"
						| "guess"
						| "hosting";
					verified: boolean;
				};
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
			startMigration: {
				params: {
					source?: MailboxCredentials;
					destination?: MailboxCredentials;
					folderMappings?: FolderMapping[];
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
				params: { checkoutUrl: string };
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
