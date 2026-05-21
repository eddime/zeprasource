import type { Database } from "bun:sqlite";
import type { FolderMapping, MailboxCredentials } from "../../../shared/types";
import { hashString } from "../crypto/local-secrets";
import { listFailedUidsForFolder } from "../../db/migration-repository";
import { classifyMigrationError } from "./migration-errors";
import { transferFolderWithLanes, type FolderTransferHooks } from "./migration-lanes";
import type { MigrationTransferConfig } from "./migration-autopilot";
import { describeFinishingRemainingActivity } from "./migration-autopilot";
import type { connectImapClient } from "../imap/imap-client";

export const MAX_FAILURE_SWEEPS = 15;
import { FAILURE_SWEEP_BASE_DELAY_MS } from "./migration-constants";

export const SWEEP_BASE_DELAY_MS = FAILURE_SWEEP_BASE_DELAY_MS;

type MarkMessageFn = Parameters<typeof transferFolderWithLanes>[0]["markMessage"];

export function countFailedUids(migrationId: string, mappings: FolderMapping[]): number {
	let total = 0;
	for (const mapping of mappings) {
		total += listFailedUidsForFolder(migrationId, mapping.sourcePath).length;
	}
	return total;
}

export function hasOnlyPermanentFailures(
	db: Database,
	migrationId: string,
	mappings: FolderMapping[],
): boolean {
	for (const mapping of mappings) {
		const folderHash = hashString(
			`migration-message-folder:${migrationId}`,
			mapping.sourcePath,
		);
		const rows = db
			.query(
				`SELECT error FROM migration_messages
         WHERE migration_id = ? AND status = 'failed'
           AND (source_folder_hash = ? OR source_folder = ?)`,
			)
			.all(migrationId, folderHash, mapping.sourcePath) as Array<{ error: string | null }>;
		for (const row of rows) {
			const classification = classifyMigrationError(new Error(row.error ?? "failed"));
			if (classification.retryable) return false;
		}
	}
	return true;
}

export async function sweepFailedMessages(options: {
	db: Database;
	migrationId: string;
	mappings: FolderMapping[];
	source: MailboxCredentials;
	destination: MailboxCredentials;
	destClient: Awaited<ReturnType<typeof connectImapClient>> | null;
	transfer: MigrationTransferConfig;
	backupRootPath: string | null;
	backupOnly: boolean;
	markMessage: MarkMessageFn;
	hooksForMapping: (mapping: FolderMapping) => FolderTransferHooks;
}): Promise<number> {
	let moved = 0;
	for (const mapping of options.mappings) {
		const hooks = options.hooksForMapping(mapping);
		if (hooks.shouldStop()) break;
		const failedUids = listFailedUidsForFolder(options.migrationId, mapping.sourcePath);
		if (failedUids.length === 0) continue;
		await transferFolderWithLanes({
			db: options.db,
			migrationId: options.migrationId,
			mapping,
			sourceCreds: options.source,
			destCreds: options.destination,
			destClient: options.destClient,
			pendingUids: failedUids,
			transfer: options.transfer,
			backupRootPath: options.backupRootPath,
			backupOnly: options.backupOnly,
			markMessage: options.markMessage,
			hooks,
		});
		moved += failedUids.length;
	}
	return moved;
}

export function describeStillWorkingActivity(remaining: number): string {
	if (remaining === 1) return "Making sure your last message arrives…";
	return `Making sure all ${remaining} remaining messages arrive…`;
}

export function describePausedWithRemaining(remaining: number): string {
	if (remaining === 1) {
		return "One message still needs another try — keep Zepra open or tap Continue.";
	}
	return `${remaining} messages still need another try — keep Zepra open or tap Continue.`;
}
