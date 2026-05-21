import { isPop3Access } from "../../../shared/mail-access";
import type {
	ConnectionTestResult,
	FolderSizeEstimate,
	ImapFolder,
	MailboxCredentials,
	MigrationSizeEstimate,
} from "../../../shared/types";
import {
	estimateMigrationSize as estimateImapMigrationSize,
	measureFolderSizes as measureImapFolderSizes,
	testImapConnection,
} from "../imap/imap-client";
import {
	estimatePop3MigrationSize,
	measurePop3Mailbox,
	testPop3Connection,
} from "../pop/pop-client";
import { buildMigrationSizeEstimate } from "../../../shared/migration-size-estimate";
import { getMigrationPricingCatalog } from "../stripe/migration-pricing-catalog";

export async function testMailConnection(
	credentials: MailboxCredentials,
): Promise<ConnectionTestResult> {
	if (isPop3Access(credentials.accessProtocol)) {
		return testPop3Connection(credentials);
	}
	return testImapConnection(credentials);
}

export async function measureMailFolderSizes(
	credentials: MailboxCredentials,
	folderPaths: string[],
): Promise<FolderSizeEstimate[]> {
	if (isPop3Access(credentials.accessProtocol)) {
		const stats = await measurePop3Mailbox(credentials);
		if (folderPaths.length === 0) return stats;
		const byPath = new Map(stats.map((s) => [s.path, s]));
		return folderPaths.map(
			(path) =>
				byPath.get(path) ?? {
					path,
					messages: stats[0]?.messages ?? 0,
					bytes: stats[0]?.bytes ?? 0,
				},
		);
	}
	return measureImapFolderSizes(credentials, folderPaths);
}

export async function estimateMailMigrationSize(
	source: MailboxCredentials,
	folderPaths: string[],
	destination?: MailboxCredentials,
): Promise<MigrationSizeEstimate> {
	if (isPop3Access(source.accessProtocol)) {
		const pop = await estimatePop3MigrationSize(source, folderPaths);
		const catalog = await getMigrationPricingCatalog();
		return buildMigrationSizeEstimate({
			folders: pop.folders,
			sourceProvider: source.provider,
			destProvider: destination?.provider ?? "generic",
			pricing: {
				configured: catalog.configured,
				freeLimitBytes: catalog.configured ? catalog.freeLimitBytes : 0,
			},
		});
	}
	return estimateImapMigrationSize(source, folderPaths, destination);
}

export function listPop3InboxFolder(): ImapFolder[] {
	return [
		{
			path: "INBOX",
			name: "Inbox",
			delimiter: "/",
			attributes: [],
		},
	];
}
