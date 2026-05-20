import { BrowserView, Utils, type RPCSchema } from "electrobun/bun";
import type { MailPortRPC } from "./schema";
import {
	getDatabasePath,
	listMigrations,
	loadSettings,
	saveSettings,
} from "../db/database";
import {
	getMigrationById,
	getMigrationProgressSnapshot,
} from "../db/migration-repository";
import {
	loadMailboxProfileForDisplay,
	saveMailboxProfile,
} from "../services/imap/mailbox-profile";
import { discoverImapSettings as lookupImapSettings } from "../services/imap/imap-autodiscover";
import { checkDestinationQuota } from "../services/imap/destination-quota";
import {
	estimateMigrationSize as computeMigrationSize,
	measureFolderSizes,
	testImapConnection,
} from "../services/imap/imap-client";
import type { FolderMapping } from "../../shared/types";
import {
	checkLocalTestServers,
	seedLocalTestSourceInbox,
} from "../services/imap/local-test-servers";
import {
	createEtherealTestMailboxes,
	seedEtherealInbox,
} from "../services/imap/ethereal-test-mailboxes";
import {
	cancelMigration,
	enqueueMigration,
	getActiveMigrationIds,
	getResumableMigrations,
	MigrationCapacityError,
	pauseMigration,
	type ProgressEmitter,
} from "../services/migration/migration-engine";
import type { MigrationProgress } from "../../shared/types";

let progressEmitter: ProgressEmitter | null = null;
let mainWindowRpc: ReturnType<typeof BrowserView.defineRPC<MailPortRPC>> | null = null;

export function setProgressBridge(
	rpc: ReturnType<typeof BrowserView.defineRPC<MailPortRPC>>,
): void {
	mainWindowRpc = rpc;
	progressEmitter = (progress: MigrationProgress) => {
		rpc.send.migrationProgress(progress);
	};
}

export function getProgressEmitter(): ProgressEmitter | null {
	return progressEmitter;
}

export const mailportRpc = BrowserView.defineRPC<MailPortRPC>({
	maxRequestTime: 300_000,
	handlers: {
		requests: {
			testConnection: async ({ credentials }) => {
				return testImapConnection(credentials);
			},

			discoverImapSettings: async ({ email, password }) =>
				lookupImapSettings(email, { password }),

			listFolders: async ({ credentials }) => {
				const result = await testImapConnection(credentials);
				return result.folders ?? [];
			},

			saveMailboxProfile: ({ role, credentials }) => {
				return saveMailboxProfile(role, credentials);
			},

			getMailboxProfile: ({ role }) => loadMailboxProfileForDisplay(role),

			estimateMigrationSize: async ({ source, folderPaths }) => {
				return computeMigrationSize(source, folderPaths);
			},

			fetchFolderStats: async ({ source, folderPaths }) => {
				return measureFolderSizes(source, folderPaths);
			},

			checkDestinationQuota: async ({ destination, requiredBytes, requiredMessages }) => {
				return checkDestinationQuota(destination, {
					bytes: requiredBytes,
					messages: requiredMessages,
				});
			},

			startMigration: async (params) => {
				if (!progressEmitter) {
					throw new Error("Progress bridge not initialized");
				}
				if (
					!params.resumeMigrationId &&
					params.source &&
					params.destination &&
					params.folderMappings
				) {
					const folderPaths = params.folderMappings
						.filter((m: FolderMapping) => m.selected)
						.map((m: FolderMapping) => m.sourcePath);
					if (folderPaths.length > 0) {
						const estimate = await computeMigrationSize(params.source, folderPaths);
						const quota = await checkDestinationQuota(params.destination, {
							bytes: estimate.totalBytes,
							messages: estimate.messageCount,
						});
						if (
							quota.status === "insufficient_storage" ||
							quota.status === "insufficient_messages"
						) {
							throw new Error(quota.summary);
						}
					}
				}
				try {
					const migrationId = await enqueueMigration(params, progressEmitter);
					return { migrationId };
				} catch (error) {
					if (error instanceof MigrationCapacityError) {
						throw new Error(error.message);
					}
					throw error;
				}
			},

			cancelMigration: ({ migrationId }) => {
				cancelMigration(migrationId);
				return { success: true };
			},

			pauseMigration: ({ migrationId }) => {
				pauseMigration(migrationId);
				const emit = getProgressEmitter();
				if (emit) {
					const snapshot = getMigrationProgressSnapshot(
						migrationId,
						"paused",
						undefined,
						{ reconcile: true },
					);
					if (snapshot) emit(snapshot);
				}
				return { success: true };
			},

			getMigrationProgress: ({ migrationId }) =>
				getMigrationProgressSnapshot(migrationId, undefined, undefined, {
					reconcile: true,
				}),

			listMigrations: ({ limit }) => listMigrations(limit ?? 50),

			getResumableMigrations: () => getResumableMigrations(),

			getActiveMigrationIds: () => getActiveMigrationIds(),

			getSettings: () => loadSettings(),

			saveSettings: ({ settings }) => {
				saveSettings(settings);
				return loadSettings();
			},

			getDataDirectory: () => ({
				path: getDatabasePath(),
			}),

			checkLocalTestServers: () => checkLocalTestServers(),

			seedLocalTestSource: () => seedLocalTestSourceInbox(),

			createEtherealTestMailboxes: () => createEtherealTestMailboxes(),

			seedEtherealTestSource: async ({ credentials }) => {
				try {
					await seedEtherealInbox(credentials);
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : "Seed failed",
					};
				}
			},
		},
		messages: {},
	},
});
