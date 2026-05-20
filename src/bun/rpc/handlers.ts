import { BrowserView, Utils, type RPCSchema } from "electrobun/bun";
import { randomUUID } from "node:crypto";
import type { MailPortRPC } from "./schema";
import {
	getDatabase,
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
	createCredentialRef,
	credentialStore,
} from "../services/credentials/credential-store";
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
import type { MailboxCredentials, MigrationProgress } from "../../shared/types";

type StoredProfile = {
	id: string;
	role: string;
	provider: string;
	email: string;
	host: string;
	port: number;
	secure: number;
	auth_method: string;
	username: string | null;
	credential_ref: string;
};

function persistSecret(credentials: MailboxCredentials): string {
	const ref = createCredentialRef(credentials.email);
	credentialStore.store(ref, credentials.password ?? "");
	return ref;
}

function loadCredentialsFromProfile(row: StoredProfile): MailboxCredentials | null {
	const secret = credentialStore.retrieve(row.credential_ref);
	if (secret === null) return null;

	return {
		provider: row.provider as MailboxCredentials["provider"],
		email: row.email,
		host: row.host,
		port: row.port,
		secure: Boolean(row.secure),
		authMethod: "password",
		username: row.username ?? undefined,
		password: secret,
	};
}

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
				const db = getDatabase();
				const credentialRef = persistSecret(credentials);
				const profileId = randomUUID();

				const existing = db
					.query("SELECT credential_ref FROM mailbox_profiles WHERE role = ?")
					.all(role) as Array<{ credential_ref: string }>;
				for (const row of existing) {
					credentialStore.delete(row.credential_ref);
				}
				db.prepare("DELETE FROM mailbox_profiles WHERE role = ?").run(role);

				db.prepare(
					`INSERT INTO mailbox_profiles (
            id, role, provider, email, host, port, secure, auth_method, username, credential_ref, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
				).run(
					profileId,
					role,
					credentials.provider,
					credentials.email,
					credentials.host,
					credentials.port,
					credentials.secure ? 1 : 0,
					credentials.authMethod,
					credentials.username ?? null,
					credentialRef,
				);

				return { profileId };
			},

			getMailboxProfile: ({ role }) => {
				const db = getDatabase();
				const row = db
					.query(
						`SELECT * FROM mailbox_profiles WHERE role = ? ORDER BY updated_at DESC LIMIT 1`,
					)
					.get(role) as StoredProfile | null;
				if (!row) return null;
				const creds = loadCredentialsFromProfile(row);
				if (!creds) return null;
				return { ...creds, password: undefined };
			},

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
