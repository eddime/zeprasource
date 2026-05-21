/** Normalize mailbox paths for reliable UI ↔ IMAP matching. */
export function normalizeFolderPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").trim().toLowerCase();
}

export function folderPathsMatch(a: string, b: string): boolean {
	return normalizeFolderPath(a) === normalizeFolderPath(b);
}
