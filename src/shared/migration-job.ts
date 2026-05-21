/** Stored on migrations.dest_email for backup-only jobs (no IMAP destination). */
export const LOCAL_BACKUP_DEST_EMAIL = "local-backup@zepra";

export type MigrationJobType = "migrate" | "backup";

export function isLocalBackupDestEmail(email: string): boolean {
	return email === LOCAL_BACKUP_DEST_EMAIL;
}
