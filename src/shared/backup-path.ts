/** Join path segments without node:path (safe in Vite / browser). */
function joinPath(...parts: string[]): string {
	const normalized = parts
		.map((part) => part.trim().replace(/\\/g, "/"))
		.filter((part) => part.length > 0);
	if (normalized.length === 0) return "";
	const joined = normalized.join("/").replace(/\/+/g, "/");
	if (joined.startsWith("//") && !joined.startsWith("///")) {
		return joined.slice(1);
	}
	return joined;
}

/** Safe single path segment for email or IMAP folder names. */
export function sanitizePathSegment(segment: string): string {
	const trimmed = segment.trim();
	if (!trimmed) return "_empty";
	const safe = trimmed
		.replace(/[/\\:\0]/g, "_")
		.replace(/\.\./g, "_")
		.replace(/^\.+/, "")
		.replace(/_+/g, "_")
		.slice(0, 180);
	return safe.length > 0 ? safe : "_";
}

export function resolveBackupAccountDir(parentDir: string, sourceEmail: string): string {
	return joinPath(parentDir.trim(), sanitizePathSegment(sourceEmail));
}

export function backupFolderDir(accountDir: string, folderPath: string): string {
	return joinPath(accountDir, sanitizePathSegment(folderPath));
}

export function backupMessageFilePath(
	accountDir: string,
	folderPath: string,
	uid: number,
): string {
	return joinPath(backupFolderDir(accountDir, folderPath), `${uid}.eml`);
}
