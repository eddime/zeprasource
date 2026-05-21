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
	clearMailboxProfiles,
	loadMailboxProfileForDisplay,
	saveMailboxProfile,
} from "../services/imap/mailbox-profile";
import { discoverMailboxSettings as lookupMailboxSettings } from "../services/imap/imap-autodiscover";
import {
	estimateMailMigrationSize,
	measureMailFolderSizes,
	testMailConnection,
} from "../services/mail/mail-connection";
import { checkDestinationQuota } from "../services/imap/destination-quota";
import {
	checkBackupDiskSpace,
	defaultBackupParentDir,
	pickBackupDirectoryNative,
} from "../services/backup/backup-disk";
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
	resumeMigration,
	type ProgressEmitter,
} from "../services/migration/migration-engine";
import { runMigrationPreflight } from "../services/migration/migration-preflight";
import { loadMigrationResumePayload } from "../services/migration/migration-resume";
import { assertMigrationResumeLicense } from "../services/stripe/migration-payment-entitlements";
import {
	cancelledProgressExtras,
	userPauseProgressExtras,
} from "../../shared/migration-progress";
import type { MigrationProgress } from "../../shared/types";
import {
	createMigrationCheckout,
	isMigrationCheckoutConfigured,
	waitForMigrationCheckout,
} from "../services/stripe/migration-checkout";
import { getMigrationPricingCatalog } from "../services/stripe/migration-pricing-catalog";
import { getLifetimePricingCatalog } from "../services/stripe/lifetime-pricing-catalog";
import {
	createLifetimeCheckout,
	waitForLifetimeCheckout,
} from "../services/stripe/lifetime-checkout";
import { getEntitlementStatus } from "../services/lifetime/lifetime-entitlement";

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
			testConnection: async ({ credentials }) => testMailConnection(credentials),

			discoverImapSettings: async ({ email, password }) =>
				lookupMailboxSettings(email, { password }),

			listFolders: async ({ credentials }) => {
				const result = await testMailConnection(credentials);
				return result.folders ?? [];
			},

			saveMailboxProfile: ({ role, credentials }) => {
				return saveMailboxProfile(role, credentials);
			},

			getMailboxProfile: ({ role }) => loadMailboxProfileForDisplay(role),

			clearMailboxProfiles: () => {
				clearMailboxProfiles();
				return { success: true as const };
			},

			estimateMigrationSize: async ({ source, folderPaths, destination }) =>
				estimateMailMigrationSize(source, folderPaths, destination),

			fetchFolderStats: async ({ source, folderPaths }) =>
				measureMailFolderSizes(source, folderPaths),

			checkDestinationQuota: async ({ destination, requiredBytes, requiredMessages }) => {
				return checkDestinationQuota(destination, {
					bytes: requiredBytes,
					messages: requiredMessages,
				});
			},

			getDefaultBackupParentDir: () => ({
				defaultPath: defaultBackupParentDir(),
			}),

			pickBackupDirectory: () => {
				const picked = pickBackupDirectoryNative();
				return {
					path: picked,
					defaultPath: defaultBackupParentDir(),
				};
			},

			checkBackupDiskSpace: async ({ parentDir, requiredBytes }) =>
				checkBackupDiskSpace(parentDir, requiredBytes),

			startMigration: async (params) => {
				if (!progressEmitter) {
					throw new Error("Progress bridge not initialized");
				}
				const verifiedLicense = await runMigrationPreflight(params);
				let plannedSecondsTypical = params.plannedSecondsTypical;
				if (
					!params.resumeMigrationId &&
					params.source &&
					params.destination &&
					params.folderMappings &&
					plannedSecondsTypical === undefined
				) {
					const folderPaths = params.folderMappings
						.filter((m: FolderMapping) => m.selected)
						.map((m: FolderMapping) => m.sourcePath);
					if (folderPaths.length > 0) {
						const estimate = await estimateMailMigrationSize(
							params.source,
							folderPaths,
							params.destination,
						);
						plannedSecondsTypical = estimate.secondsTypical;
					}
				}
				try {
					const migrationId = await enqueueMigration(
						{ ...params, plannedSecondsTypical, verifiedLicense },
						progressEmitter,
					);
					const snapshot = getMigrationProgressSnapshot(
						migrationId,
						"running",
						undefined,
						{ reconcile: true },
					);
					if (snapshot) progressEmitter(snapshot);
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
				const emit = getProgressEmitter();
				if (emit) {
					const snapshot = getMigrationProgressSnapshot(
						migrationId,
						"cancelled",
						cancelledProgressExtras(),
						{ reconcile: true },
					);
					if (snapshot) emit(snapshot);
				}
				return { success: true };
			},

			pauseMigration: ({ migrationId }) => {
				pauseMigration(migrationId);
				const emit = getProgressEmitter();
				if (emit) {
					const snapshot = getMigrationProgressSnapshot(
						migrationId,
						"paused",
						userPauseProgressExtras(),
						{ reconcile: true },
					);
					if (snapshot) emit(snapshot);
				}
				return { success: true };
			},

			resumeMigration: async ({ migrationId }) => {
				if (!progressEmitter) {
					throw new Error("Progress bridge not initialized");
				}
				const payload = loadMigrationResumePayload(migrationId);
				if (!payload) {
					throw new Error(
						"Migration cannot be resumed — reconnect your mailboxes and try again.",
					);
				}
				const folderPaths = payload.folderMappings
					.filter((m) => m.selected)
					.map((m) => m.sourcePath);
				await assertMigrationResumeLicense(migrationId, folderPaths);
				await resumeMigration(migrationId, progressEmitter);
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

			isStripeConfigured: () => ({
				configured: isMigrationCheckoutConfigured(),
			}),

			createMigrationCheckout: (params) => createMigrationCheckout(params),

			openMigrationCheckout: ({ checkoutUrl }) => ({
				opened: Utils.openExternal(checkoutUrl),
			}),

			waitForMigrationCheckout: ({ sessionId }) =>
				waitForMigrationCheckout(sessionId),

			getMigrationPricingCatalog: () => getMigrationPricingCatalog(),

			getZepraPricingCatalog: async () => {
				const [perGb, lifetime] = await Promise.all([
					getMigrationPricingCatalog(),
					getLifetimePricingCatalog(),
				]);
				return { perGb, lifetime };
			},

			getEntitlementStatus: () => getEntitlementStatus(),

			createLifetimeCheckout: () => createLifetimeCheckout(),

			waitForLifetimeCheckout: ({ sessionId }) =>
				waitForLifetimeCheckout(sessionId),
		},
		messages: {},
	},
});
