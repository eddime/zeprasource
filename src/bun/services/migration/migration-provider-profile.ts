import type { MailboxCredentials, MailboxProvider } from "../../../shared/types";

/**
 * Universal migration tuning — no hostname sniffing.
 * Only the user-selected provider type (gmail/outlook/icloud/generic) adjusts batch sizes.
 */
export type MigrationProviderProfile = {
	id: string;
	fetchBatchSize: number;
	maxFetchBatchSize: number;
	/** Max total RFC822.SIZE per FETCH batch (byte-budget pipelining). */
	fetchByteBudgetBytes: number;
	interBatchPauseMs: number;
	pipelineQueueDepth: number;
	retryBaseMs: number;
	retryMaxMs: number;
	/** Batches without errors before fetch batch size grows. */
	stableBatchesToGrow: number;
};

const BASE: MigrationProviderProfile = {
	id: "base",
	fetchBatchSize: 30,
	maxFetchBatchSize: 60,
	fetchByteBudgetBytes: 3 * 1024 * 1024,
	interBatchPauseMs: 50,
	pipelineQueueDepth: 3,
	retryBaseMs: 1_500,
	retryMaxMs: 25_000,
	stableBatchesToGrow: 8,
};

const BY_PROVIDER: Partial<Record<MailboxProvider, Partial<MigrationProviderProfile>>> = {
	gmail: {
		id: "gmail",
		fetchBatchSize: 40,
		maxFetchBatchSize: 80,
		interBatchPauseMs: 40,
	},
	outlook: {
		id: "outlook",
		fetchBatchSize: 35,
		maxFetchBatchSize: 70,
		interBatchPauseMs: 60,
	},
	icloud: {
		id: "icloud",
		fetchBatchSize: 35,
		maxFetchBatchSize: 65,
		interBatchPauseMs: 70,
	},
	generic: {
		id: "generic",
	},
};

function profileForProvider(provider: MailboxProvider): MigrationProviderProfile {
	const patch = BY_PROVIDER[provider] ?? BY_PROVIDER.generic ?? {};
	return { ...BASE, ...patch, id: patch.id ?? provider };
}

function profileForCredentials(credentials: MailboxCredentials): MigrationProviderProfile {
	return profileForProvider(credentials.provider);
}

/** Pick conservative merge of source + destination (smaller batches, longer pauses). */
export function resolveMigrationProviderProfile(
	source: MailboxCredentials,
	destination: MailboxCredentials | null,
	backupOnly: boolean,
): MigrationProviderProfile {
	const sourceProfile = profileForCredentials(source);
	if (backupOnly || !destination) {
		return sourceProfile;
	}

	const destProfile = profileForCredentials(destination);

	return {
		id: `${sourceProfile.id}+${destProfile.id}`,
		fetchBatchSize: Math.min(sourceProfile.fetchBatchSize, destProfile.fetchBatchSize),
		maxFetchBatchSize: Math.min(
			sourceProfile.maxFetchBatchSize,
			destProfile.maxFetchBatchSize,
		),
		fetchByteBudgetBytes: Math.min(
			sourceProfile.fetchByteBudgetBytes,
			destProfile.fetchByteBudgetBytes,
		),
		interBatchPauseMs: Math.max(
			sourceProfile.interBatchPauseMs,
			destProfile.interBatchPauseMs,
		),
		pipelineQueueDepth: Math.min(
			sourceProfile.pipelineQueueDepth,
			destProfile.pipelineQueueDepth,
		),
		retryBaseMs: Math.max(sourceProfile.retryBaseMs, destProfile.retryBaseMs),
		retryMaxMs: Math.max(sourceProfile.retryMaxMs, destProfile.retryMaxMs),
		stableBatchesToGrow: Math.max(
			sourceProfile.stableBatchesToGrow,
			destProfile.stableBatchesToGrow,
		),
	};
}
