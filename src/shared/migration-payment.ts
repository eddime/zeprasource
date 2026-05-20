import { createHash } from "node:crypto";

/** Stable hash of selected source folder paths (must match at payment and migration start). */
export function hashFolderSelection(folderPaths: string[]): string {
	const sorted = [...folderPaths].sort();
	return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex");
}
