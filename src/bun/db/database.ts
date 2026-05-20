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

CREATE INDEX IF NOT EXISTS idx_migrations_status ON migrations(status);
`;

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
	ensurePrivacyColumns(db);

	const settingsRow = db
		.query("SELECT value FROM settings WHERE key = 'app'")
		.get() as { value: string } | null;
	if (!settingsRow) {
		saveSettings(DEFAULT_SETTINGS);
	}

	return db;
}

function hasColumn(database: Database, table: string, column: string): boolean {
	const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
	}>;
	return rows.some((row) => row.name === column);
}

function ensurePrivacyColumns(database: Database): void {
	if (!hasColumn(database, "migration_folders", "source_path_hash")) {
		database.exec("ALTER TABLE migration_folders ADD COLUMN source_path_hash TEXT");
	}
	if (!hasColumn(database, "migration_messages", "source_folder_hash")) {
		database.exec("ALTER TABLE migration_messages ADD COLUMN source_folder_hash TEXT");
	}
	database.exec("DROP INDEX IF EXISTS idx_migration_messages_folder_hash_uid;");
	database.exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_migration_messages_folder_hash_uid
     ON migration_messages(migration_id, source_folder_hash, source_uid);`,
	);
	database.exec(
		`CREATE INDEX IF NOT EXISTS idx_migration_folders_source_path_hash
     ON migration_folders(migration_id, source_path_hash);`,
	);
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
			`SELECT id, source_email, dest_email, status, folders_total, folders_completed,
        messages_total, messages_completed, messages_failed, bytes_transferred,
        created_at, completed_at, error
       FROM migrations ORDER BY created_at DESC LIMIT ?`,
		)
		.all(limit) as Array<{
		id: string;
		source_email: string;
		dest_email: string;
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
