import { isPop3Access } from "../../../shared/mail-access";
import type { MailAccessProtocol } from "../../../shared/mail-access";
import type {
	ConnectionTestResult,
	FolderSizeEstimate,
	ImapFolder,
	MailboxCredentials,
	MigrationSizeEstimate,
} from "../../../shared/types";
import {
	discoverMailboxSettings,
	type ImapDiscoverySource,
} from "../imap/imap-autodiscover";
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

export type ConnectMailboxResult = ConnectionTestResult & {
	host: string;
	port: number;
	secure: boolean;
	provider: MailboxCredentials["provider"];
	accessProtocol: MailAccessProtocol;
	source: ImapDiscoverySource;
};

/** Streaming autodiscovery + connection test in one RPC round-trip. */
export async function connectMailbox(
	email: string,
	password: string,
): Promise<ConnectMailboxResult> {
	const trimmedEmail = email.trim();
	const trimmedPassword = password.trim();
	const discovered = await discoverMailboxSettings(trimmedEmail, {
		password: trimmedPassword,
		collectFolders: true,
	});
	const settings = {
		host: discovered.host,
		port: discovered.port,
		secure: discovered.secure,
		provider: discovered.provider,
		accessProtocol: discovered.accessProtocol,
		source: discovered.source,
	};

	if (discovered.folders) {
		return {
			success: true,
			folders: discovered.folders,
			...settings,
		};
	}

	const credentials: MailboxCredentials = {
		provider: discovered.provider,
		email: trimmedEmail,
		host: discovered.host,
		port: discovered.port,
		secure: discovered.secure,
		authMethod: "password",
		password: trimmedPassword,
		accessProtocol: discovered.accessProtocol,
	};
	const connection = await testMailConnection(credentials);
	return {
		...connection,
		...settings,
	};
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
