import { accessSync, constants, existsSync, statfsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type BackupDiskCheck = {
	ok: boolean;
	path: string;
	freeBytes: number;
	requiredBytes: number;
	summary: string;
};

export function defaultBackupParentDir(): string {
	return join(homedir(), "Documents", "Zepra-Backup");
}

/** Native folder picker (macOS); returns null if cancelled or unsupported. */
export function pickBackupDirectoryNative(): string | null {
	if (process.platform === "darwin") {
		const script =
			'POSIX path of (choose folder with prompt "Choose where to save your local backup")';
		const result = spawnSync("osascript", ["-e", script], {
			encoding: "utf8",
			timeout: 120_000,
		});
		if (result.status !== 0) return null;
		const path = result.stdout?.trim();
		return path && path.length > 0 ? path : null;
	}
	return null;
}

export async function ensureDirectoryWritable(dir: string): Promise<void> {
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}
	accessSync(dir, constants.W_OK | constants.R_OK);
}

export function freeBytesAtPath(dir: string): number {
	try {
		const target = existsSync(dir) ? dir : join(dir, "..");
		const stats = statfsSync(target);
		return Number(stats.bavail) * Number(stats.bsize);
	} catch {
		return 0;
	}
}

export async function checkBackupDiskSpace(
	parentDir: string,
	requiredBytes: number,
): Promise<BackupDiskCheck> {
	const path = parentDir.trim();
	if (!path) {
		return {
			ok: false,
			path,
			freeBytes: 0,
			requiredBytes,
			summary: "Choose a folder for your local backup.",
		};
	}

	try {
		await ensureDirectoryWritable(path);
	} catch {
		return {
			ok: false,
			path,
			freeBytes: 0,
			requiredBytes,
			summary: "That folder is not writable. Choose another location.",
		};
	}

	const freeBytes = freeBytesAtPath(path);
	if (requiredBytes > 0 && freeBytes < requiredBytes) {
		const needGb = (requiredBytes / 1024 ** 3).toFixed(1);
		const freeGb = (freeBytes / 1024 ** 3).toFixed(1);
		return {
			ok: false,
			path,
			freeBytes,
			requiredBytes,
			summary: `Not enough disk space (need ~${needGb} GB, ${freeGb} GB free).`,
		};
	}

	return {
		ok: true,
		path,
		freeBytes,
		requiredBytes,
		summary:
			requiredBytes > 0
				? `About ${(requiredBytes / 1024 ** 3).toFixed(1)} GB will be copied to this Mac.`
				: "Backup folder is ready.",
	};
}
