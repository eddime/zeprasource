import type {
	FolderMapping,
	MailboxCredentials,
	MigrationJobType,
} from "../../../shared/types";
import { checkDestinationQuota } from "../imap/destination-quota";
import {
	buildMigrationSizeEstimate,
	folderMappingsToSizeEstimates,
} from "../../../shared/migration-size-estimate";
import {
	estimateMigrationSize,
	testImapConnection,
} from "../imap/imap-client";
import { getMigrationPricingCatalog } from "../stripe/migration-pricing-catalog";
import {
	assertMigrationResumeLicense,
	assertPaidMigrationCanStart,
	type VerifiedLaunchLicense,
} from "../stripe/migration-payment-entitlements";
import { loadMigrationResumePayload } from "./migration-resume";

export type MigrationPreflightParams = {
	source?: MailboxCredentials;
	destination?: MailboxCredentials;
	folderMappings?: FolderMapping[];
	backupRootPath?: string | null;
	jobType?: MigrationJobType;
	resumeMigrationId?: string;
	/** Signed license from Stripe checkout (`zepra1.…`). */
	launchTicket?: string;
};

function isAutomatedTestHost(host: string): boolean {
	return host === "localhost" || host.endsWith(".test");
}

export async function verifySourceMailbox(source: MailboxCredentials): Promise<void> {
	await assertMailboxReachable("source", source);
}

export async function verifyMigrationMailboxes(
	source: MailboxCredentials,
	destination: MailboxCredentials,
): Promise<void> {
	if (isAutomatedTestHost(source.host) && isAutomatedTestHost(destination.host)) {
		return;
	}
	await assertMailboxReachable("source", source);
	await assertMailboxReachable("destination", destination);
}

async function assertMailboxReachable(
	role: "source" | "destination",
	credentials: MailboxCredentials,
): Promise<void> {
	const result = await testImapConnection(credentials);
	if (result.success) return;
	const label = role === "source" ? "source mailbox" : "destination mailbox";
	throw new Error(
		result.error ?? `Could not connect to your ${label}. Check your login and try again.`,
	);
}

export async function runMigrationPreflight(
	params: MigrationPreflightParams,
): Promise<VerifiedLaunchLicense | null> {
	if (params.resumeMigrationId) {
		const payload = loadMigrationResumePayload(params.resumeMigrationId);
		if (!payload) {
			throw new Error(
				"Migration cannot continue — reconnect your mailboxes and try again.",
			);
		}
		if (payload.jobType === "backup") {
			await assertMailboxReachable("source", payload.source);
		} else {
			await verifyMigrationMailboxes(payload.source, payload.destination);
		}
		const folderPaths = payload.folderMappings
			.filter((m) => m.selected)
			.map((m) => m.sourcePath);
		await assertMigrationResumeLicense(params.resumeMigrationId, folderPaths);
		return null;
	}

	const { source, destination, folderMappings, backupRootPath, jobType = "migrate" } =
		params;
	if (!source) {
		throw new Error("Connect your mailbox before starting.");
	}

	const selected = (folderMappings ?? []).filter((m) => m.selected);
	if (selected.length === 0) {
		throw new Error(
			jobType === "backup"
				? "Select at least one folder to back up."
				: "Select at least one folder to move.",
		);
	}

	const folderPaths = selected.map((m) => m.sourcePath);

	if (jobType === "backup") {
		if (!backupRootPath?.trim()) {
			throw new Error("Choose a folder for your local backup.");
		}
		await assertMailboxReachable("source", source);
		return null;
	}

	if (!destination) {
		throw new Error("Connect both mailboxes before starting.");
	}

	await verifyMigrationMailboxes(source, destination);

	const cachedFolders = folderMappingsToSizeEstimates(selected);
	const catalog = await getMigrationPricingCatalog();
	const estimate =
		cachedFolders != null
			? buildMigrationSizeEstimate({
					folders: cachedFolders,
					sourceProvider: source.provider,
					destProvider: destination.provider,
					pricing: {
						configured: catalog.configured,
						freeLimitBytes: catalog.configured
							? catalog.freeLimitBytes
							: 0,
					},
				})
			: await estimateMigrationSize(source, folderPaths, destination);
	const quota = await checkDestinationQuota(destination, {
		bytes: estimate.totalBytes,
		messages: estimate.messageCount,
	});

	if (
		quota.status === "insufficient_storage" ||
		quota.status === "insufficient_messages"
	) {
		throw new Error(quota.summary);
	}

	return assertPaidMigrationCanStart({
		launchTicket: params.launchTicket,
		folderPaths,
		totalBytes: estimate.totalBytes,
		messageCount: estimate.messageCount,
	});
}
