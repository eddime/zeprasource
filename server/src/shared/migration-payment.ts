import { createHash } from "node:crypto";

export function hashFolderSelection(folderPaths: string[]): string {
	const sorted = [...folderPaths].sort();
	return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex");
}
