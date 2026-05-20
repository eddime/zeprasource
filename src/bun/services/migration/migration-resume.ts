import type { FolderMapping, MailboxCredentials } from "../../../shared/types";
import { getDatabase } from "../../db/database";
import { syncMigrationCounters } from "../../db/migration-repository";
import { credentialStore } from "../credentials/credential-store";
import { decryptString } from "../crypto/local-secrets";
import { loadMailboxCredentialsByRole } from "../imap/mailbox-profile";
import { logger } from "../../utils/logger";

function migrationCredentialRef(migrationId: string, side: "source" | "destination"): string {
	return `migration/${migrationId}/${side}`;
}

function serializeMailbox(credentials: MailboxCredentials): string {
	return JSON.stringify({
		provider: credentials.provider,
		email: credentials.email,
		host: credentials.host,
		port: credentials.port,
		secure: credentials.secure,
		authMethod: credentials.authMethod,
		username: credentials.username,
		password: credentials.password,
	});
}

function deserializeMailbox(raw: string): MailboxCredentials | null {
	try {
		const parsed = JSON.parse(raw) as MailboxCredentials;
		if (!parsed?.email || !parsed?.host) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function snapshotMigrationMailboxes(
	migrationId: string,
	source: MailboxCredentials,
	destination: MailboxCredentials,
): void {
	credentialStore.store(migrationCredentialRef(migrationId, "source"), serializeMailbox(source));
	credentialStore.store(
		migrationCredentialRef(migrationId, "destination"),
		serializeMailbox(destination),
	);

	const db = getDatabase();
	db.prepare(
		`UPDATE migrations SET
      source_profile_id = ?,
      dest_profile_id = ?,
      updated_at = datetime('now')
     WHERE id = ?`,
	).run(
		migrationCredentialRef(migrationId, "source"),
		migrationCredentialRef(migrationId, "destination"),
		migrationId,
	);
}

function loadMailboxFromSnapshot(
	migrationId: string,
	side: "source" | "destination",
): MailboxCredentials | null {
	const raw = credentialStore.retrieve(migrationCredentialRef(migrationId, side));
	if (!raw) return null;
	return deserializeMailbox(raw);
}

function loadFolderMappingsFromDb(migrationId: string): FolderMapping[] {
	const db = getDatabase();
	const row = db
		.query("SELECT folder_mappings FROM migrations WHERE id = ?")
		.get(migrationId) as { folder_mappings: string | null } | null;

	if (row?.folder_mappings) {
		try {
			const raw = decryptString(row.folder_mappings) ?? row.folder_mappings;
			const parsed = JSON.parse(raw) as FolderMapping[];
			if (Array.isArray(parsed) && parsed.length > 0) {
				return parsed.filter((m) => m.selected !== false);
			}
		} catch {
			/* fall through */
		}
	}

	const folders = db
		.query(
			`SELECT source_path, dest_path FROM migration_folders WHERE migration_id = ? ORDER BY source_path`,
		)
		.all(migrationId) as Array<{ source_path: string; dest_path: string }>;

	return folders.map((f) => ({
		sourcePath: f.source_path,
		destPath: f.dest_path,
		selected: true,
	}));
}

export type MigrationResumePayload = {
	migrationId: string;
	source: MailboxCredentials;
	destination: MailboxCredentials;
	folderMappings: FolderMapping[];
};

export function loadMigrationResumePayload(
	migrationId: string,
): MigrationResumePayload | null {
	const db = getDatabase();
	const row = db
		.query(
			`SELECT id, status, source_email, dest_email FROM migrations WHERE id = ?`,
		)
		.get(migrationId) as {
		id: string;
		status: string;
		source_email: string;
		dest_email: string;
	} | null;

	if (!row) return null;
	if (row.status === "completed" || row.status === "cancelled") return null;

	let source = loadMailboxFromSnapshot(migrationId, "source");
	let destination = loadMailboxFromSnapshot(migrationId, "destination");

	if (!source) source = loadMailboxCredentialsByRole("source");
	if (!destination) destination = loadMailboxCredentialsByRole("destination");

	if (!source || !destination) {
		logger.error(
			"migration",
			`Resume payload missing credentials for ${migrationId}`,
		);
		return null;
	}

	const folderMappings = loadFolderMappingsFromDb(migrationId);
	if (folderMappings.length === 0) {
		logger.error("migration", `Resume payload has no folders for ${migrationId}`);
		return null;
	}

	return { migrationId, source, destination, folderMappings };
}

/** Crash-safe: in-flight "running" rows become pausable checkpoints. */
export function checkpointInterruptedMigrations(): string[] {
	const db = getDatabase();
	const rows = db
		.query(`SELECT id FROM migrations WHERE status = 'running' ORDER BY updated_at DESC`)
		.all() as Array<{ id: string }>;

	for (const { id } of rows) {
		syncMigrationCounters(id);
		db.prepare(
			`UPDATE migrations SET status = 'paused', updated_at = datetime('now') WHERE id = ?`,
		).run(id);
	}

	const paused = db
		.query(
			`SELECT id FROM migrations WHERE status IN ('paused', 'failed') ORDER BY updated_at DESC`,
		)
		.all() as Array<{ id: string }>;

	return paused.map((r) => r.id);
}

export function pauseMigrationForShutdown(migrationId: string): void {
	syncMigrationCounters(migrationId);
	const db = getDatabase();
	db.prepare(
		`UPDATE migrations SET status = 'paused', updated_at = datetime('now') WHERE id = ? AND status IN ('running', 'paused')`,
	).run(migrationId);
}
