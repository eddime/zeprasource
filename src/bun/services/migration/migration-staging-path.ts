import { join } from "node:path";
import { getDataDirectory } from "../../db/database";
import { sanitizePathSegment } from "../../../shared/backup-path";

export function migrationStagingRoot(migrationId: string): string {
	return join(getDataDirectory(), "migrations", sanitizePathSegment(migrationId), "staging");
}

export function stagingFolderDir(stagingRoot: string, folderPath: string): string {
	return join(stagingRoot, sanitizePathSegment(folderPath));
}

export function stagingMessagePath(
	stagingRoot: string,
	folderPath: string,
	uid: number,
): string {
	return join(stagingFolderDir(stagingRoot, folderPath), `${uid}.eml`);
}

export function stagingMetaPath(
	stagingRoot: string,
	folderPath: string,
	uid: number,
): string {
	return join(stagingFolderDir(stagingRoot, folderPath), `${uid}.meta.json`);
}
