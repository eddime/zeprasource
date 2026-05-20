import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { backupMessageFilePath } from "./backup-path";

export type BackupWriteResult =
	| { status: "written"; path: string; bytes: number }
	| { status: "skipped"; path: string; reason: "exists" }
	| { status: "failed"; path: string; error: string };

/** Write raw RFC822 message to disk after a successful IMAP append. */
export async function writeBackupMessage(options: {
	accountDir: string;
	folderPath: string;
	uid: number;
	source: Buffer;
}): Promise<BackupWriteResult> {
	const path = backupMessageFilePath(
		options.accountDir,
		options.folderPath,
		options.uid,
	);

	try {
		if (existsSync(path)) {
			return { status: "skipped", path, reason: "exists" };
		}
		await mkdir(dirname(path), { recursive: true });
		await Bun.write(path, options.source);
		return { status: "written", path, bytes: options.source.byteLength };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: "failed", path, error: message };
	}
}
