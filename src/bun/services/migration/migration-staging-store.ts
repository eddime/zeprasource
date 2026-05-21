import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FetchedMigrationMessage } from "../imap/imap-client";
import {
	stagingMessagePath,
	stagingMetaPath,
} from "./migration-staging-path";

export type StagedMessageMeta = {
	uid: number;
	messageId?: string;
	flags: string[];
	internalDate?: string;
	sha256: string;
	sizeBytes: number;
};

export function hashMessageSource(source: Buffer): string {
	return createHash("sha256").update(source).digest("hex");
}

export class MigrationStagingStore {
	constructor(private readonly stagingRoot: string) {}

	messagePath(folderPath: string, uid: number): string {
		return stagingMessagePath(this.stagingRoot, folderPath, uid);
	}

	has(folderPath: string, uid: number): boolean {
		return (
			existsSync(stagingMessagePath(this.stagingRoot, folderPath, uid)) &&
			existsSync(stagingMetaPath(this.stagingRoot, folderPath, uid))
		);
	}

	async write(folderPath: string, msg: FetchedMigrationMessage): Promise<StagedMessageMeta> {
		const emlPath = stagingMessagePath(this.stagingRoot, folderPath, msg.uid);
		const metaPath = stagingMetaPath(this.stagingRoot, folderPath, msg.uid);
		const sha256 = hashMessageSource(msg.source);
		const meta: StagedMessageMeta = {
			uid: msg.uid,
			messageId: msg.messageId,
			flags: Array.from(msg.flags ?? []),
			internalDate: msg.internalDate?.toISOString(),
			sha256,
			sizeBytes: msg.source.byteLength,
		};

		await mkdir(dirname(emlPath), { recursive: true });
		await Bun.write(emlPath, msg.source);
		await Bun.write(metaPath, JSON.stringify(meta));
		return meta;
	}

	async read(folderPath: string, uid: number): Promise<FetchedMigrationMessage | null> {
		const emlPath = stagingMessagePath(this.stagingRoot, folderPath, uid);
		const metaPath = stagingMetaPath(this.stagingRoot, folderPath, uid);
		if (!existsSync(emlPath) || !existsSync(metaPath)) return null;

		const meta = JSON.parse(await Bun.file(metaPath).text()) as StagedMessageMeta;
		const source = Buffer.from(await Bun.file(emlPath).arrayBuffer());
		const liveHash = hashMessageSource(source);
		if (liveHash !== meta.sha256) {
			throw new Error(`Staging corrupt for UID ${uid} in ${folderPath}`);
		}

		return {
			uid: meta.uid,
			source,
			flags: new Set(meta.flags),
			internalDate: meta.internalDate ? new Date(meta.internalDate) : undefined,
			messageId: meta.messageId,
		};
	}

	async remove(folderPath: string, uid: number): Promise<void> {
		const emlPath = stagingMessagePath(this.stagingRoot, folderPath, uid);
		const metaPath = stagingMetaPath(this.stagingRoot, folderPath, uid);
		try {
			if (existsSync(emlPath)) await Bun.file(emlPath).unlink();
		} catch {
			/* gone */
		}
		try {
			if (existsSync(metaPath)) await Bun.file(metaPath).unlink();
		} catch {
			/* gone */
		}
	}
}
