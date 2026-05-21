<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import onmoveBg from "@/assets/onmove-bg.png";
import WelcomeStep from "../components/onboarding/WelcomeStep.vue";
import ZebraMascot from "../components/zebra/ZebraMascot.vue";
import ZebraProgressBar from "../components/zebra/ZebraProgressBar.vue";
import SetupConnectStep from "../components/setup/SetupConnectStep.vue";
import type { ConnectTarget } from "../components/setup/DestinationModePicker.vue";
import SetupFoldersStep from "../components/setup/SetupFoldersStep.vue";
import MigrationPricingStep from "../components/migration/MigrationPricingStep.vue";
import MigrationMailParticles from "../components/migration/MigrationMailParticles.vue";
import AppButton from "../components/ui/AppButton.vue";
import type { MigrationSizeEstimate } from "../../shared/types";
import { resolveBackupAccountDir } from "../../shared/backup-path";
import { MIGRATION_COPY } from "../../shared/migration-copy";
import {
	estimateMigrationDuration,
	formatMigrationDurationHint,
} from "../../shared/migration-duration";
import {
	buildMigrationSizeEstimate,
	folderMappingsToSizeEstimates,
} from "../../shared/migration-size-estimate";
import { isDestinationQuotaBlocked } from "../../shared/destination-quota";
import { getRpc } from "../lib/electrobun";
import { useMailboxesStore } from "../stores/mailboxes";
import { useMigrationStore } from "../stores/migration";
import { usePricingStore } from "../stores/pricing";
import { paymentErrorMessage } from "../../shared/user-messages";

type Step = "welcome" | "setup" | "folders" | "pricing";

const step = ref<Step>("welcome");
const estimatingSize = ref(false);
const sizeEstimate = ref<MigrationSizeEstimate | null>(null);
const pricingContinueLoading = ref(false);
const pricingPaymentError = ref<string | null>(null);
const stripeConfigured = ref(false);
const estimateError = ref<string | null>(null);
const quotaWarning = ref<string | null>(null);
const connectTarget = ref<ConnectTarget | null>(null);
const localBackupEnabled = ref(false);
const backupParentDir = ref("");
const backupDiskError = ref<string | null>(null);
const pickingBackupDir = ref(false);

const mailboxes = useMailboxesStore();
const migration = useMigrationStore();
const pricing = usePricingStore();

const {
	source,
	destination,
	sourceValidated,
	destValidated,
	folderMappings,
	sourceTestError,
	destTestError,
	testingSource,
	testingDest,
	loadingFolderStats,
	measuringFolderBytes,
	folderStatsError,
	folderStatsProgress,
} = storeToRefs(mailboxes);

const { progress, overallPercent, ui, isLiveMigration, plannedDurationHint } =
	storeToRefs(migration);

const bothConnected = computed(
	() => sourceValidated.value && destValidated.value,
);

/** Backup path from step 1 — keep working on step 2 even if connectTarget was cleared. */
const backupOnlyFlow = computed(
	() =>
		connectTarget.value === "backup" ||
		(Boolean(backupParentDir.value.trim()) &&
			connectTarget.value !== "mail" &&
			!destValidated.value),
);

const selectedFolderCount = computed(
	() => folderMappings.value.filter((f) => f.selected).length,
);

const backupReady = computed(
	() => backupParentDir.value.trim().length > 0 && !backupDiskError.value,
);

const readyForFolders = computed(() => {
	if (!sourceValidated.value) return false;
	if (connectTarget.value === "mail") return destValidated.value;
	if (connectTarget.value === "backup") return backupReady.value;
	return false;
});

const usesDock = computed(
	() =>
		step.value === "welcome" ||
		step.value === "setup" ||
		step.value === "folders" ||
		step.value === "pricing",
);

const isMigrationPaused = computed(
	() => ui.value.phase === "userPaused" || ui.value.phase === "enginePaused",
);

function clearFinishedMigration() {
	const status = progress.value?.status;
	if (status === "completed" || status === "failed" || status === "cancelled") {
		migration.resetFocused();
	}
}

async function openSession(id: string) {
	await migration.focusSession(id);
	const status = progress.value?.status;
	if (!status) return;

	step.value = "setup";

	if (status === "completed" || status === "cancelled") {
		return;
	}

	if (status === "failed") {
		const active = await getRpc().request.getActiveMigrationIds({});
		if (!active.includes(id)) {
			await migration.start(id);
		}
	}
}

async function goToSetup() {
	clearFinishedMigration();
	estimateError.value = null;
	quotaWarning.value = null;
	plannedDurationHint.value = null;
	sizeEstimate.value = null;
	connectTarget.value = null;
	await mailboxes.resetForNewMigration();
	step.value = "setup";
}

async function goToFolders() {
	if (!readyForFolders.value) return;
	step.value = "folders";
	await mailboxes.loadFolderStats();
}

function onSourceCredentialsEdited() {
	sourceValidated.value = false;
	connectTarget.value = null;
	destValidated.value = false;
}

function backFromSetup() {
	step.value = "welcome";
}

function backFromFolders() {
	estimateError.value = null;
	quotaWarning.value = null;
	backupDiskError.value = null;
	step.value = "setup";
}

function selectedFolderTotals(): { totalBytes: number; messageCount: number } {
	return folderMappings.value
		.filter((f) => f.selected)
		.reduce(
			(acc, f) => ({
				totalBytes: acc.totalBytes + (f.bytes ?? 0),
				messageCount: acc.messageCount + (f.messages ?? 0),
			}),
			{ totalBytes: 0, messageCount: 0 },
		);
}

async function refreshBackupDiskHint(requiredBytes: number) {
	const usesBackupDir =
		backupParentDir.value.trim() &&
		(localBackupEnabled.value || connectTarget.value === "backup");
	if (!usesBackupDir) {
		backupDiskError.value = null;
		return;
	}
	const disk = await getRpc().request.checkBackupDiskSpace({
		parentDir: backupParentDir.value,
		requiredBytes,
	});
	backupDiskError.value = disk.ok ? null : disk.summary;
}

async function pickBackupDir() {
	pickingBackupDir.value = true;
	backupDiskError.value = null;
	try {
		const { path, defaultPath } = await getRpc().request.pickBackupDirectory({});
		if (path) {
			backupParentDir.value = path;
			const settings = await getRpc().request.getSettings({});
			await getRpc().request.saveSettings({
				settings: { ...settings, lastBackupParentDir: path },
			});
		} else if (!backupParentDir.value) {
			backupParentDir.value = defaultPath;
		}
		const bytes = folderMappings.value
			.filter((f) => f.selected)
			.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
		await refreshBackupDiskHint(bytes);
	} finally {
		pickingBackupDir.value = false;
	}
}

async function resolveBackupRootForStart(
	estimate: MigrationSizeEstimate,
	required = false,
): Promise<string | null> {
	if (!required && !localBackupEnabled.value) return null;
	if (!backupParentDir.value.trim()) {
		throw new Error("Choose a folder for your local backup.");
	}
	await refreshBackupDiskHint(estimate.totalBytes);
	if (backupDiskError.value) {
		throw new Error(backupDiskError.value);
	}
	return resolveBackupAccountDir(backupParentDir.value, source.value.email);
}

async function resolveBackupRootForBackupStart(): Promise<string> {
	if (!backupParentDir.value.trim()) {
		throw new Error("Choose a folder for your local backup.");
	}
	const { totalBytes } = selectedFolderTotals();
	if (totalBytes > 0) {
		await refreshBackupDiskHint(totalBytes);
		if (backupDiskError.value) {
			throw new Error(backupDiskError.value);
		}
	}
	return resolveBackupAccountDir(backupParentDir.value, source.value.email);
}

async function buildStartEstimate(): Promise<MigrationSizeEstimate> {
	const cachedFolders = folderMappingsToSizeEstimates(folderMappings.value);
	if (cachedFolders != null) {
		await pricing.ensureLoaded();
		const catalog = pricing.activeCatalog;
		return buildMigrationSizeEstimate({
			folders: cachedFolders,
			sourceProvider: source.value.provider,
			destProvider: destination.value.provider,
			pricing: {
				configured: catalog?.configured === true,
				freeLimitBytes: catalog?.freeLimitBytes ?? 0,
			},
		});
	}

	const selectedPaths = folderMappings.value
		.filter((f) => f.selected)
		.map((f) => f.sourcePath);

	return getRpc().request.estimateMigrationSize({
		source: source.value,
		destination: destination.value,
		folderPaths: selectedPaths,
	});
}

async function verifyDestinationQuota(estimate: MigrationSizeEstimate) {
	quotaWarning.value = null;
	const quota = await getRpc().request.checkDestinationQuota({
		destination: destination.value,
		requiredBytes: estimate.totalBytes,
		requiredMessages: estimate.messageCount,
	});
	if (isDestinationQuotaBlocked(quota.status)) {
		throw new Error(quota.summary);
	}
	if (quota.status === "unsupported") {
		quotaWarning.value = quota.summary;
	}
}

async function verifySource() {
	await mailboxes.testConnection("source");
}

async function verifyDest() {
	await mailboxes.testConnection("destination");
}

async function onCloudTestMailboxes() {
	await mailboxes.applyEtherealTestMailboxes();
	await mailboxes.seedEtherealTestSource();
}

async function startMigration() {
	if (estimatingSize.value) return;
	if (selectedFolderCount.value === 0) {
		estimateError.value = "Select at least one folder.";
		return;
	}

	estimateError.value = null;
	quotaWarning.value = null;

	if (backupOnlyFlow.value) {
		if (!backupParentDir.value.trim()) {
			estimateError.value = "Choose a folder for your local backup in step 1.";
			return;
		}
		try {
			const { totalBytes, messageCount } = selectedFolderTotals();
			const duration = estimateMigrationDuration({
				totalBytes,
				messageCount,
				sourceProvider: source.value.provider,
				destProvider: "generic",
			});
			plannedDurationHint.value = formatMigrationDurationHint(duration);
			const backupRootPath = await resolveBackupRootForBackupStart();
			await migration.start(undefined, {
				plannedSecondsTypical: duration.secondsTypical,
				backupRootPath,
				jobType: "backup",
			});
		} catch (error) {
			estimateError.value =
				error instanceof Error ? error.message : "Could not start backup";
		}
		return;
	}

	if (!readyForFolders.value) return;

	estimatingSize.value = true;
	try {
		const estimate = await buildStartEstimate();
		await verifyDestinationQuota(estimate);
		plannedDurationHint.value = formatMigrationDurationHint(estimate);

		if (estimate.requiresPayment) {
			await pricing.refreshEntitlement(true);
			if (pricing.hasLifetime) {
				const backupRootPath = await resolveBackupRootForStart(estimate);
				await migration.start(undefined, {
					plannedSecondsTypical: estimate.secondsTypical,
					backupRootPath,
				});
				step.value = "setup";
				return;
			}
			sizeEstimate.value = estimate;
			step.value = "pricing";
			return;
		}

		const backupRootPath = await resolveBackupRootForStart(estimate);

		await migration.start(undefined, {
			plannedSecondsTypical: estimate.secondsTypical,
			backupRootPath,
		});
		step.value = "setup";
	} catch (error) {
		estimateError.value =
			error instanceof Error ? error.message : "Could not estimate mailbox size";
	} finally {
		estimatingSize.value = false;
	}
}

function backFromPricing() {
	step.value = "folders";
	sizeEstimate.value = null;
}

/** Dev shortcut from welcome — opens pricing with a mock paid estimate. */
function goToPaymentTest() {
	pricingPaymentError.value = null;
	estimateError.value = null;
	sizeEstimate.value = {
		totalBytes: 12 * 1024 ** 3,
		messageCount: 8_420,
		folders: [
			{ path: "INBOX", messages: 4_200, bytes: 6 * 1024 ** 3 },
			{ path: "Sent", messages: 2_100, bytes: 4 * 1024 ** 3 },
			{ path: "Archive", messages: 2_120, bytes: 2 * 1024 ** 3 },
		],
		requiresPayment: true,
		freeLimitBytes: 2 * 1024 ** 3,
		durationLabel: "~2 hours",
		durationRangeLabel: "about 1–3 hours",
		secondsTypical: 7_200,
	};
	if (folderMappings.value.filter((f) => f.selected).length === 0) {
		folderMappings.value = [
			{
				sourcePath: "INBOX",
				destPath: "INBOX",
				selected: true,
				messages: 4_200,
				bytes: 6 * 1024 ** 3,
			},
			{
				sourcePath: "Sent",
				destPath: "Sent",
				selected: true,
				messages: 2_100,
				bytes: 4 * 1024 ** 3,
			},
			{
				sourcePath: "Archive",
				destPath: "Archive",
				selected: true,
				messages: 2_120,
				bytes: 2 * 1024 ** 3,
			},
		];
	}
	step.value = "pricing";
	void pricing.ensureLoaded(true).then(() => {
		stripeConfigured.value = pricing.stripeLive;
	});
}

watch(step, async (current) => {
	if (current !== "pricing") return;
	pricingPaymentError.value = null;
	await pricing.ensureLoaded(true);
	stripeConfigured.value = pricing.stripeLive;
});

async function confirmLifetimeAndMigrate() {
	if (!sizeEstimate.value) return;
	pricingContinueLoading.value = true;
	pricingPaymentError.value = null;
	plannedDurationHint.value = formatMigrationDurationHint(sizeEstimate.value);
	try {
		await pricing.purchaseLifetime();
		const backupRootPath = await resolveBackupRootForStart(sizeEstimate.value);
		await migration.start(undefined, {
			plannedSecondsTypical: sizeEstimate.value.secondsTypical,
			backupRootPath,
		});
		sizeEstimate.value = null;
		step.value = "setup";
	} catch (error) {
		pricingPaymentError.value = paymentErrorMessage(error);
	} finally {
		pricingContinueLoading.value = false;
	}
}

async function confirmPricingAndMigrate() {
	if (!sizeEstimate.value) return;
	pricingContinueLoading.value = true;
	pricingPaymentError.value = null;
	plannedDurationHint.value = formatMigrationDurationHint(sizeEstimate.value);
	try {
		if (!pricing.isReady) {
			throw new Error("pricing_unavailable");
		}
		const quote = pricing.quoteForBytes(sizeEstimate.value.totalBytes);
		if (quote.id === "free") {
			throw new Error("within_free_limit");
		}

		const folderPaths = folderMappings.value
			.filter((f) => f.selected)
			.map((f) => f.sourcePath);
		const checkout = await getRpc().request.createMigrationCheckout({
			billableGb: quote.billableGb,
			totalBytes: sizeEstimate.value.totalBytes,
			messageCount: sizeEstimate.value.messageCount,
			folderCount: folderPaths.length,
			folderPaths,
		});

		if (!checkout.configured) {
			throw new Error("checkout_unavailable");
		}

		const opened = await getRpc().request.openMigrationCheckout({
			checkoutUrl: checkout.checkoutUrl,
			sessionId: checkout.sessionId,
		});
		if (!opened.opened) {
			throw new Error("browser_open_failed");
		}

		const payment = await getRpc().request.waitForMigrationCheckout({
			sessionId: checkout.sessionId,
		});
		if (!payment.paid) {
			throw new Error(payment.error ?? "payment_failed");
		}

		if (payment.lifetimeLicense) {
			await pricing.refreshEntitlement(true);
		}

		const backupRootPath = await resolveBackupRootForStart(sizeEstimate.value);

		await migration.start(undefined, {
			plannedSecondsTypical: sizeEstimate.value.secondsTypical,
			launchTicket: payment.launchTicket,
			backupRootPath,
		});
		step.value = "setup";
		sizeEstimate.value = null;
	} catch (error) {
		pricingPaymentError.value = paymentErrorMessage(error);
	} finally {
		pricingContinueLoading.value = false;
	}
}

function onDone() {
	migration.resetFocused();
	step.value = "welcome";
	void migration.hydrateSessions();
}

onMounted(async () => {
	void pricing.ensureLoaded();
	void pricing.refreshEntitlement();
	const settings = await getRpc().request.getSettings({});
	if (settings.lastBackupParentDir) {
		backupParentDir.value = settings.lastBackupParentDir;
	} else {
		const { defaultPath } = await getRpc().request.getDefaultBackupParentDir({});
		backupParentDir.value = defaultPath;
	}
});

watch([localBackupEnabled, () => folderMappings.value], async () => {
	if (!localBackupEnabled.value) {
		backupDiskError.value = null;
		return;
	}
	const bytes = folderMappings.value
		.filter((f) => f.selected)
		.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
	await refreshBackupDiskHint(bytes);
});

async function startAnotherMigration() {
	migration.resetFocused();
	plannedDurationHint.value = null;
	estimateError.value = null;
	quotaWarning.value = null;
	sizeEstimate.value = null;
	await mailboxes.resetForNewMigration();
	step.value = "setup";
}
</script>

<template>
	<div class="app-frame">
		<div
			v-show="isLiveMigration"
			class="onmove-scene"
			:class="{ 'onmove-scene--paused': isMigrationPaused }"
			aria-hidden="true"
		>
			<div class="onmove-bg">
				<div
					class="onmove-bg-layer"
					:style="{ backgroundImage: `url(${onmoveBg})` }"
				/>
			</div>
			<div class="onmove-vignette" />
			<MigrationMailParticles v-if="ui.showParticles" :paused="isMigrationPaused" />
		</div>
		<main
			class="content"
			:class="{ 'content-dock': usesDock, 'content-welcome': step === 'welcome' }"
		>
			<Transition name="screen" mode="out-in">
				<WelcomeStep
					v-if="step === 'welcome'"
					key="w"
					class="step-view"
					@start="goToSetup"
					@select-session="openSession"
					@test-payment="goToPaymentTest"
				/>

				<MigrationPricingStep
					v-else-if="step === 'pricing' && sizeEstimate"
					key="p"
					class="step-view"
					:estimate="sizeEstimate"
					:loading="pricingContinueLoading"
					:stripe-configured="stripeConfigured"
					:payment-error="pricingPaymentError"
					@back="backFromPricing"
					@continue="confirmPricingAndMigrate"
				/>

				<div v-else key="s" class="setup step-view">
					<div v-if="isLiveMigration" class="hero-stack">
						<ZebraMascot :state="ui.zebraState" :size="178" class="hero-zebra" />
						<div class="hero-copy">
							<p class="hero-title">{{ ui.headline }}</p>
							<p class="hero-sub">{{ ui.subline }}</p>
							<ZebraProgressBar
								v-if="ui.showProgressBar"
								class="hero-progress"
								:percent="overallPercent"
								:label="ui.progressLabel"
							/>
							<div v-if="ui.canPause" class="hero-actions row">
								<AppButton variant="secondary" @click="migration.pause()">
									Pause
								</AppButton>
								<AppButton variant="ghost" @click="migration.cancel()">
									{{ MIGRATION_COPY.buttons.cancelMigration }}
								</AppButton>
							</div>
							<div v-else-if="ui.canResume" class="hero-actions row">
								<AppButton size="lg" @click="migration.resume()">
									Resume
								</AppButton>
								<AppButton variant="ghost" @click="migration.cancel()">
									{{ MIGRATION_COPY.buttons.cancelMigration }}
								</AppButton>
							</div>
							<div v-else-if="ui.canContinue" class="hero-actions row">
								<AppButton size="lg" @click="migration.resume()">
									Continue
								</AppButton>
								<AppButton variant="ghost" @click="migration.cancel()">
									{{ MIGRATION_COPY.buttons.cancelMigration }}
								</AppButton>
							</div>
							<div v-else-if="ui.showWarmingHint" class="hero-actions row">
								<p class="hero-resume-hint">{{ ui.subline }}</p>
								<AppButton variant="ghost" @click="migration.cancel()">
									{{ MIGRATION_COPY.buttons.cancelMigration }}
								</AppButton>
							</div>
							<div v-else-if="ui.canRestart" class="hero-actions">
								<AppButton size="lg" @click="migration.start(progress!.migrationId)">
									Restart
								</AppButton>
							</div>
							<div
								v-else-if="
									progress?.status === 'completed' ||
									progress?.status === 'cancelled'
								"
								class="hero-actions row"
							>
								<AppButton size="lg" @click="startAnotherMigration">
									New migration
								</AppButton>
								<AppButton variant="secondary" size="lg" @click="onDone">
									Done
								</AppButton>
							</div>
						</div>
					</div>

					<SetupFoldersStep
						v-else-if="step === 'folders'"
						v-model:folder-mappings="folderMappings"
						v-model:local-backup-enabled="localBackupEnabled"
						v-model:backup-parent-dir="backupParentDir"
						:backup-only="backupOnlyFlow"
						:source-provider="source.provider"
						:dest-provider="destination.provider"
						:loading-stats="loadingFolderStats"
						:measuring-bytes="measuringFolderBytes"
						:stats-completed="folderStatsProgress?.completed"
						:stats-total="folderStatsProgress?.total"
						:stats-error="folderStatsError"
						:estimating-size="estimatingSize"
						:estimate-error="estimateError"
						:quota-warning="quotaWarning"
						:backup-disk-error="backupDiskError"
						:picking-backup-dir="pickingBackupDir"
						@back="backFromFolders"
						@retry-stats="mailboxes.loadFolderStats(true)"
						@pick-backup-dir="pickBackupDir"
						@start-migration="startMigration"
					/>

					<SetupConnectStep
						v-else-if="step === 'setup'"
						v-model:source="source"
						v-model:destination="destination"
						v-model:connect-target="connectTarget"
						v-model:backup-parent-dir="backupParentDir"
						:subline="subline"
						:source-validated="sourceValidated"
						:dest-validated="destValidated"
						:backup-ready="backupReady"
						:testing-source="testingSource"
						:testing-dest="testingDest"
						:source-test-error="sourceTestError"
						:dest-test-error="destTestError"
						:backup-disk-error="backupDiskError"
						:picking-backup-dir="pickingBackupDir"
						@back="backFromSetup"
						@verify-source="verifySource"
						@verify-dest="verifyDest"
						@credentials-edited-source="onSourceCredentialsEdited"
						@credentials-edited-dest="destValidated = false"
						@apply-source="mailboxes.applyLocalTestSource()"
						@apply-dest="mailboxes.applyLocalTestDest()"
						@apply-cloud="onCloudTestMailboxes"
						@pick-backup-dir="pickBackupDir"
						@continue="goToFolders"
					/>
				</div>
			</Transition>
		</main>
	</div>

</template>

<style scoped>
.app-frame {
	position: relative;
	width: 100%;
	height: 100%;
	max-height: 100%;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-sizing: border-box;
}

.onmove-scene {
	position: absolute;
	inset: 0;
	z-index: 0;
	overflow: hidden;
	pointer-events: none;
}

.onmove-bg {
	--onmove-bg-h: min(62vh, 420px);
	--onmove-tile-w: calc(var(--onmove-bg-h) * 1672 / 941);
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	width: 100%;
	height: var(--onmove-bg-h);
	overflow: hidden;
	opacity: 0.55;
}

.onmove-vignette {
	position: absolute;
	inset: 0;
	z-index: 1;
	pointer-events: none;
	background: #fff;
	-webkit-mask-image: radial-gradient(
		ellipse 88% 84% at 50% 42%,
		transparent 0%,
		transparent 18%,
		rgba(0, 0, 0, 0.55) 34%,
		#000 52%,
		#000 100%
	);
	mask-image: radial-gradient(
		ellipse 88% 84% at 50% 42%,
		transparent 0%,
		transparent 18%,
		rgba(0, 0, 0, 0.55) 34%,
		#000 52%,
		#000 100%
	);
}

/* repeat-x fills full window width — no empty gap on the right while scrolling */
.onmove-bg-layer {
	width: 100%;
	height: 100%;
	background-repeat: repeat-x;
	background-size: var(--onmove-tile-w) var(--onmove-bg-h);
	background-position: 0 top;
	will-change: background-position;
	animation: onmove-bg-shift 8s linear infinite;
}

@keyframes onmove-bg-shift {
	0% {
		background-position: 0 top;
	}
	100% {
		background-position: calc(-1 * var(--onmove-tile-w)) top;
	}
}

.onmove-scene--paused .onmove-bg-layer {
	animation-play-state: paused;
}

.content {
	position: relative;
	z-index: 1;
	flex: 1;
	min-height: 0;
	width: 100%;
	padding: 0.5rem var(--site-padding-x) 0;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.content-dock {
	padding-bottom: 0;
}

.content-welcome {
	padding-top: 0;
	padding-left: 0;
	padding-right: 0;
}

.content :deep(.step-view) {
	flex: 1;
	min-height: 0;
	width: 100%;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	align-items: stretch;
}

.setup {
	width: 100%;
	max-width: 100%;
	justify-content: flex-start;
	align-items: stretch;
	gap: 0;
}

.hero-stack {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	text-align: center;
	padding: 80px 0 0.25rem;
	width: 100%;
	overflow: hidden;
}

.hero-zebra {
	margin-bottom: 0;
	flex-shrink: 0;
}

.hero-copy {
	display: flex;
	flex-direction: column;
	align-items: center;
	max-width: 520px;
	flex-shrink: 0;
	margin-top: 3rem;
}
.hero-title {
	margin: 0;
	font-size: 1.85rem;
	font-weight: 700;
	letter-spacing: -0.03em;
	line-height: 1.15;
}
.hero-sub {
	margin: 0.35rem 0 0;
	font-size: 0.85rem;
	color: var(--muted);
}
.hero-progress {
	margin-top: 0.5rem;
	width: 100%;
	max-width: 520px;
	flex-shrink: 0;
}
.hero-actions {
	margin-top: 0.65rem;
	flex-shrink: 0;
}
.hero-actions.row {
	display: flex;
	gap: 0.65rem;
	justify-content: center;
	align-items: center;
}
.hero-resume-hint {
	margin: 0;
	font-size: 0.85rem;
	color: var(--muted);
}
.screen-enter-active,
.screen-leave-active {
	transition:
		opacity 0.35s ease,
		transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.screen-enter-from {
	opacity: 0;
	transform: translateY(12px);
}
.screen-leave-to {
	opacity: 0;
	transform: translateY(-8px);
}
@media (prefers-reduced-motion: reduce) {
	.onmove-bg-layer {
		animation: none;
	}

	.onmove-scene--paused .onmove-bg-layer {
		animation: none;
	}

	.screen-enter-active,
	.screen-leave-active {
		transition: opacity 0.2s ease;
	}
	.screen-enter-from,
	.screen-leave-to {
		transform: none;
	}
}
</style>
