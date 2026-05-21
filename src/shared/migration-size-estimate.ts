import type {
	FolderMapping,
	FolderSizeEstimate,
	MailboxProvider,
	MigrationSizeEstimate,
} from "./types";
import { estimateMigrationDuration } from "./migration-duration";
import { requiresPaidPlan } from "./pricing";

export type MigrationPricingSnapshot = {
	configured: boolean;
	freeLimitBytes: number;
};

export function buildMigrationSizeEstimate(input: {
	folders: FolderSizeEstimate[];
	sourceProvider: MailboxProvider;
	destProvider: MailboxProvider;
	pricing: MigrationPricingSnapshot;
}): MigrationSizeEstimate {
	let totalBytes = 0;
	let messageCount = 0;
	for (const folder of input.folders) {
		totalBytes += folder.bytes;
		messageCount += folder.messages;
	}

	const duration = estimateMigrationDuration({
		totalBytes,
		messageCount,
		sourceProvider: input.sourceProvider,
		destProvider: input.destProvider,
	});

	const { configured, freeLimitBytes } = input.pricing;

	return {
		totalBytes,
		messageCount,
		folders: input.folders,
		requiresPayment:
			configured && requiresPaidPlan(totalBytes, freeLimitBytes),
		freeLimitBytes,
		durationLabel: duration.label,
		durationRangeLabel: duration.rangeLabel,
		secondsTypical: duration.secondsTypical,
	};
}

/** Use folder rows from UI measurement when every selected folder has stats. */
export function folderMappingsToSizeEstimates(
	mappings: FolderMapping[],
): FolderSizeEstimate[] | null {
	const selected = mappings.filter((m) => m.selected);
	if (selected.length === 0) return null;
	if (
		!selected.every(
			(m) => m.messages !== undefined && m.bytes !== undefined,
		)
	) {
		return null;
	}
	return selected.map((m) => ({
		path: m.sourcePath,
		messages: m.messages!,
		bytes: m.bytes!,
	}));
}
