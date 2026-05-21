import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Utils } from "electrobun/bun";
import type { AppSettings, MigrationRecord, MigrationStatus } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/types";
import { decryptString } from "../services/crypto/local-secrets";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mailbox_profiles (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('source', 'destination')),
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  secure INTEGER NOT NULL DEFAULT 1,
  auth_method TEXT NOT NULL DEFAULT 'password',
  username TEXT,
  credential_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  source_profile_id TEXT NOT NULL,
  dest_profile_id TEXT NOT NULL,
  source_email TEXT NOT NULL,
  dest_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  folders_total INTEGER NOT NULL DEFAULT 0,
  folders_completed INTEGER NOT NULL DEFAULT 0,
  messages_total INTEGER NOT NULL DEFAULT 0,
  messages_completed INTEGER NOT NULL DEFAULT 0,
  messages_failed INTEGER NOT NULL DEFAULT 0,
  bytes_transferred INTEGER NOT NULL DEFAULT 0,
  folder_mappings TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS migration_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_path_hash TEXT,
  dest_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  messages_total INTEGER NOT NULL DEFAULT 0,
  messages_completed INTEGER NOT NULL DEFAULT 0,
  messages_failed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(migration_id, source_path),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS migration_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_id TEXT NOT NULL,
  source_folder TEXT NOT NULL,
  source_folder_hash TEXT,
  source_uid INTEGER NOT NULL,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  transferred_at TEXT,
  UNIQUE(migration_id, source_folder, source_uid),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_migration_messages_status
  ON migration_messages(migration_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_messages_folder_hash_uid
  ON migration_messages(migration_id, source_folder_hash, source_uid);

CREATE INDEX IF NOT EXISTS idx_migration_folders_source_path_hash
  ON migration_folders(migration_id, source_path_hash);

CREATE TABLE IF NOT EXISTS migration_dest_dedup_meta (
  migration_id TEXT NOT NULL,
  dest_folder_hash TEXT NOT NULL,
  dest_path TEXT NOT NULL,
  built_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (migration_id, dest_folder_hash),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS migration_dest_message_ids (
  migration_id TEXT NOT NULL,
  dest_folder_hash TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (migration_id, dest_folder_hash, message_id),
  FOREIGN KEY (migration_id) REFERENCES migrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_migration_dest_message_ids_lookup
  ON migration_dest_message_ids(migration_id, dest_folder_hash);

CREATE INDEX IF NOT EXISTS idx_migrations_status ON migrations(status);

CREATE TABLE IF NOT EXISTS migration_payment_entitlements (
  id TEXT PRIMARY KEY,
  stripe_session_id TEXT NOT NULL UNIQUE,
  tier_id TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  folder_paths_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  migration_id TEXT,
  FOREIGN KEY (migration_id) REFERENCES migrations(id)
);

CREATE INDEX IF NOT EXISTS idx_migration_payment_entitlements_unconsumed
  ON migration_payment_entitlements(consumed_at, expires_at);

CREATE TABLE IF NOT EXISTS used_launch_tickets (
  jti TEXT PRIMARY KEY,
  stripe_session_id TEXT NOT NULL,
  migration_id TEXT,
  used_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function applySchemaMigrations(database: Database): void {
	const migrationColumns = database
		.query("PRAGMA table_info(migrations)")
		.all() as Array<{ name: string }>;
	const names = new Set(migrationColumns.map((c) => c.name));
	const addColumn = (sql: string) => {
		try {
			database.exec(sql);
		} catch {
			/* column may already exist */
		}
	};
	if (!names.has("stripe_session_id")) {
		addColumn("ALTER TABLE migrations ADD COLUMN stripe_session_id TEXT");
	}
	if (!names.has("license_jti")) {
		addColumn("ALTER TABLE migrations ADD COLUMN license_jti TEXT");
	}
	if (!names.has("licensed_total_bytes")) {
		addColumn("ALTER TABLE migrations ADD COLUMN licensed_total_bytes INTEGER");
	}
	if (!names.has("license_folder_hash")) {
		addColumn("ALTER TABLE migrations ADD COLUMN license_folder_hash TEXT");
	}
	if (!names.has("backup_root_path")) {
		addColumn("ALTER TABLE migrations ADD COLUMN backup_root_path TEXT");
	}
	if (!names.has("user_paused")) {
		addColumn("ALTER TABLE migrations ADD COLUMN user_paused INTEGER NOT NULL DEFAULT 0");
	}
	if (!names.has("job_type")) {
		addColumn("ALTER TABLE migrations ADD COLUMN job_type TEXT NOT NULL DEFAULT 'migrate'");
	}

	const profileColumns = database
		.query("PRAGMA table_info(mailbox_profiles)")
		.all() as Array<{ name: string }>;
	const profileNames = new Set(profileColumns.map((c) => c.name));
	if (!profileNames.has("access_protocol")) {
		addColumn(
			"ALTER TABLE mailbox_profiles ADD COLUMN access_protocol TEXT NOT NULL DEFAULT 'imap'",
		);
	}

	const messageColumns = database
		.query("PRAGMA table_info(migration_messages)")
		.all() as Array<{ name: string }>;
	const messageNames = new Set(messageColumns.map((c) => c.name));
	if (!messageNames.has("source_folder_hash")) {
		addColumn("ALTER TABLE migration_messages ADD COLUMN source_folder_hash TEXT");
	}
	if (!messageNames.has("content_sha256")) {
		addColumn("ALTER TABLE migration_messages ADD COLUMN content_sha256 TEXT");
	}

	const folderColumns = database
		.query("PRAGMA table_info(migration_folders)")
		.all() as Array<{ name: string }>;
	const folderNames = new Set(folderColumns.map((c) => c.name));
	if (!folderNames.has("source_path_hash")) {
		addColumn("ALTER TABLE migration_folders ADD COLUMN source_path_hash TEXT");
	}
}

let db: Database | null = null;

(globalThis as { __zepraDbReset?: () => void }).__zepraDbReset = () => {
	db = null;
};

export function getDatabase(): Database {
	if (db) return db;

	const dataDir = getDataDirectory();
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}

	const dbPath = join(dataDir, "mailport.db");
	db = new Database(dbPath, { create: true });
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec(SCHEMA);
	applySchemaMigrations(db);

	const settingsRow = db
		.query("SELECT value FROM settings WHERE key = 'app'")
		.get() as { value: string } | null;
	if (!settingsRow) {
		saveSettings(DEFAULT_SETTINGS);
	}

	return db;
}

export function getDataDirectory(): string {
	return process.env.ZEPRA_DATA_DIR?.trim() || Utils.paths.userData;
}

export function getDatabasePath(): string {
	return join(getDataDirectory(), "mailport.db");
}

export function saveSettings(settings: AppSettings): void {
	const database = getDatabase();
	database
		.prepare(
			"INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		)
		.run(JSON.stringify(settings));
}

export function loadSettings(): AppSettings {
	const database = getDatabase();
	const row = database
		.query("SELECT value FROM settings WHERE key = 'app'")
		.get() as { value: string } | null;
	if (!row) return { ...DEFAULT_SETTINGS };
	try {
		return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function listMigrations(limit = 50): MigrationRecord[] {
	const database = getDatabase();
	const rows = database
		.query(
			`SELECT id, source_email, dest_email, job_type, status, folders_total, folders_completed,
        messages_total, messages_completed, messages_failed, bytes_transferred,
        created_at, completed_at, error
       FROM migrations ORDER BY created_at DESC LIMIT ?`,
		)
		.all(limit) as Array<{
		id: string;
		source_email: string;
		dest_email: string;
		job_type: string;
		status: MigrationStatus;
		folders_total: number;
		folders_completed: number;
		messages_total: number;
		messages_completed: number;
		messages_failed: number;
		bytes_transferred: number;
		created_at: string;
		completed_at: string | null;
		error: string | null;
	}>;

	return rows.map((row) => ({
		id: row.id,
		sourceEmail: decryptString(row.source_email) ?? row.source_email,
		destEmail: decryptString(row.dest_email) ?? row.dest_email,
		jobType: row.job_type === "backup" ? "backup" : "migrate",
		status: row.status,
		foldersTotal: row.folders_total,
		foldersCompleted: row.folders_completed,
		messagesTotal: row.messages_total,
		messagesCompleted: row.messages_completed,
		messagesFailed: row.messages_failed,
		bytesTransferred: row.bytes_transferred,
		createdAt: row.created_at,
		completedAt: row.completed_at ?? undefined,
		error: row.error ?? undefined,
	}));
}

export { getMigrationById } from "./migration-repository";
