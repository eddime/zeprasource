<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import onmoveBg from "@/assets/onmove-bg.png";
import WelcomeStep from "../components/onboarding/WelcomeStep.vue";
import ZebraMascot from "../components/zebra/ZebraMascot.vue";
import ZebraProgressBar from "../components/zebra/ZebraProgressBar.vue";
import type { ZebraState } from "../components/zebra/ZebraMascot.vue";
import SetupConnectStep from "../components/setup/SetupConnectStep.vue";
import SetupFoldersStep from "../components/setup/SetupFoldersStep.vue";
import MigrationPricingStep from "../components/migration/MigrationPricingStep.vue";
import AppButton from "../components/ui/AppButton.vue";
import type { MigrationSizeEstimate } from "../../shared/types";
import { isDestinationQuotaBlocked } from "../../shared/destination-quota";
import { getRpc } from "../lib/electrobun";
import { useMailboxesStore } from "../stores/mailboxes";
import { useMigrationStore } from "../stores/migration";

type Step = "welcome" | "setup" | "folders" | "pricing";

const step = ref<Step>("welcome");
const estimatingSize = ref(false);
const sizeEstimate = ref<MigrationSizeEstimate | null>(null);
const pricingContinueLoading = ref(false);
const estimateError = ref<string | null>(null);
const quotaWarning = ref<string | null>(null);

const mailboxes = useMailboxesStore();
const migration = useMigrationStore();

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
	folderStatsError,
} = storeToRefs(mailboxes);

const { progress, overallPercent, running, resuming, isLiveMigration } =
	storeToRefs(migration);

const bothConnected = computed(
	() => sourceValidated.value && destValidated.value,
);

const showMigrationHero = computed(() => {
	const status = progress.value?.status;
	return (
		running.value ||
		status === "running" ||
		status === "paused" ||
		status === "failed" ||
		status === "completed" ||
		status === "cancelled"
	);
});

const usesDock = computed(
	() =>
		step.value === "welcome" ||
		step.value === "setup" ||
		step.value === "folders",
);

const isMigrationPaused = computed(
	() => progress.value?.status === "paused" && !running.value,
);

const zebraState = computed((): ZebraState => {
	const status = progress.value?.status;
	if (status === "paused" && !running.value) return "paused";
	if (running.value || status === "running") return "running";
	if (status === "completed") return "success";
	if (status === "cancelled") return "idle";
	if (status === "failed") return "failed";
	return "idle";
});

const headline = computed(() => {
	const status = progress.value?.status;
	if (running.value || status === "running") return "Your zebra is on the move…";
	if (status === "paused") return "Migration paused";
	if (status === "completed") return "Wow! Migration complete.";
	if (status === "cancelled") return "Migration cancelled";
	if (status === "failed") return "Oops — something went wrong.";
	return "Connect both mailboxes";
});

const progressLabel = computed(() => {
	const p = progress.value;
	if (!p) return "";
	if (p.activityPhase === "retrying" || p.activityPhase === "reconnecting") {
		return p.retryAfterMs
			? `Retrying in ${Math.ceil(p.retryAfterMs / 1000)}s`
			: "Retrying locally…";
	}
	if (p.activityPhase === "throttled") {
		return p.retryAfterMs
			? `Provider pause · ${Math.ceil(p.retryAfterMs / 1000)}s`
			: "Provider is slowing us down";
	}
	if (p.messagesTotal > 0) {
		return `${p.messagesCompleted} of ${p.messagesTotal} messages`;
	}
	if (p.foldersTotal > 0) {
		return `${p.foldersCompleted} of ${p.foldersTotal} folders`;
	}
	return "Preparing…";
});

const subline = computed(() => {
	const status = progress.value?.status;
	if (progress.value?.activityLabel && (running.value || status === "running")) {
		return progress.value.activityLabel;
	}
	if (resuming.value || isCatchingUp.value) {
		return "Picking up where we left off…";
	}
	if (running.value || status === "running" || status === "paused") {
		return `${progress.value?.messagesCompleted ?? 0} messages moved so far`;
	}
	if (status === "completed" && progress.value) {
		return `${progress.value.messagesCompleted} messages · all processed locally`;
	}
	if (status === "cancelled" && progress.value) {
		return `${progress.value.messagesCompleted} messages moved before cancel`;
	}
	if (status === "failed") {
		return progress.value?.error ?? "Tap restart to try again";
	}
	return "Link your old inbox and where mail should land — we’ll handle the rest.";
});

const isCatchingUp = computed(
	() =>
		resuming.value ||
		(!running.value &&
			(progress.value?.status === "running" ||
				progress.value?.status === "paused" ||
				progress.value?.status === "failed")),
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

	if (status === "paused" || status === "failed") {
		const active = await getRpc().request.getActiveMigrationIds({});
		if (!active.includes(id)) {
			await migration.start(id);
		}
	}
}

function goToSetup() {
	clearFinishedMigration();
	step.value = "setup";
}

async function goToFolders() {
	if (!bothConnected.value) return;
	step.value = "folders";
	await mailboxes.loadFolderStats();
}

function backFromFolders() {
	estimateError.value = null;
	quotaWarning.value = null;
	step.value = "setup";
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
	if (!bothConnected.value || estimatingSize.value) return;

	estimatingSize.value = true;
	estimateError.value = null;
	quotaWarning.value = null;
	try {
		const rpc = getRpc();
		const selectedPaths = folderMappings.value
			.filter((f) => f.selected)
			.map((f) => f.sourcePath);
		const estimate = await rpc.request.estimateMigrationSize({
			source: source.value,
			folderPaths: selectedPaths,
		});

		await verifyDestinationQuota(estimate);

		if (estimate.requiresPayment) {
			sizeEstimate.value = estimate;
			step.value = "pricing";
			return;
		}

		await migration.start();
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

async function confirmPricingAndMigrate() {
	if (!sizeEstimate.value) return;
	pricingContinueLoading.value = true;
	try {
		await migration.start();
		step.value = "setup";
		sizeEstimate.value = null;
	} finally {
		pricingContinueLoading.value = false;
	}
}

function onDone() {
	migration.resetFocused();
	step.value = "welcome";
	void migration.hydrateSessions();
}

function startAnotherMigration() {
	migration.resetFocused();
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
				/>

				<MigrationPricingStep
					v-else-if="step === 'pricing' && sizeEstimate"
					key="p"
					class="step-view"
					:estimate="sizeEstimate"
					:loading="pricingContinueLoading"
					@back="backFromPricing"
					@continue="confirmPricingAndMigrate"
				/>

				<div v-else key="s" class="setup step-view">
					<div v-if="showMigrationHero" class="hero-stack">
						<ZebraMascot :state="zebraState" :size="178" class="hero-zebra" />
						<div class="hero-copy">
							<p class="hero-title">{{ headline }}</p>
							<p class="hero-sub">{{ subline }}</p>
							<ZebraProgressBar
								v-if="running || progress?.status === 'running' || progress?.status === 'paused'"
								class="hero-progress"
								:percent="overallPercent"
								:label="progressLabel"
							/>
							<div v-if="running" class="hero-actions row">
								<AppButton variant="secondary" @click="migration.pause()">
									Pause
								</AppButton>
								<AppButton variant="ghost" @click="migration.cancel()">
									Give up
								</AppButton>
							</div>
							<div v-else-if="isCatchingUp" class="hero-actions row">
								<p class="hero-resume-hint">Migration wird fortgesetzt…</p>
								<AppButton variant="ghost" @click="migration.cancel()">
									Give up
								</AppButton>
							</div>
							<div v-else-if="progress?.status === 'failed'" class="hero-actions">
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
						:source-email="source.email"
						:dest-email="destination.email"
						:loading-stats="loadingFolderStats"
						:stats-error="folderStatsError"
						:estimating-size="estimatingSize"
						:estimate-error="estimateError"
						:quota-warning="quotaWarning"
						@back="backFromFolders"
						@retry-stats="mailboxes.loadFolderStats(true)"
						@start-migration="startMigration"
					/>

					<SetupConnectStep
						v-else-if="step === 'setup'"
						v-model:source="source"
						v-model:destination="destination"
						:subline="subline"
						:source-validated="sourceValidated"
						:dest-validated="destValidated"
						:testing-source="testingSource"
						:testing-dest="testingDest"
						:source-test-error="sourceTestError"
						:dest-test-error="destTestError"
						@verify-source="verifySource"
						@verify-dest="verifyDest"
						@apply-source="mailboxes.applyLocalTestSource()"
						@apply-dest="mailboxes.applyLocalTestDest()"
						@apply-cloud="onCloudTestMailboxes"
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
	font-size: 1.35rem;
	font-weight: 700;
	letter-spacing: -0.03em;
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
