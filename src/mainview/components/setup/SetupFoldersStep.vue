<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { FolderMapping, MailboxProvider } from "../../../shared/types";
import {
	estimateMigrationDuration,
	formatDurationCompact,
} from "../../../shared/migration-duration";
import { formatBytes, requiresPaidPlan } from "../../../shared/pricing";
import { BACKUP_COPY } from "../../../shared/backup-copy";
import { usePricingStore } from "../../stores/pricing";
import MigrationPaidPlanNotice from "../migration/MigrationPaidPlanNotice.vue";
import SetupStepHero from "./SetupStepHero.vue";
import AppDock from "../ui/AppDock.vue";

const folderMappings = defineModel<FolderMapping[]>("folderMappings", { required: true });

const localBackupEnabled = defineModel<boolean>("localBackupEnabled", { default: false });
const backupParentDir = defineModel<string>("backupParentDir", { required: true });

const props = defineProps<{
	sourceProvider: MailboxProvider;
	destProvider: MailboxProvider;
	loadingStats: boolean;
	statsError: string | null;
	estimatingSize: boolean;
	estimateError: string | null;
	quotaWarning: string | null;
	backupDiskError: string | null;
	pickingBackupDir: boolean;
}>();

const emit = defineEmits<{
	back: [];
	retryStats: [];
	startMigration: [];
	pickBackupDir: [];
}>();

const pricing = usePricingStore();

onMounted(() => {
	void pricing.ensureLoaded();
});

function formatMessageCount(count: number): string {
	return count === 1 ? "1 email" : `${count.toLocaleString()} emails`;
}

function folderStatsLabel(folder: FolderMapping): string {
	if (props.loadingStats && folder.messages === undefined) return "Measuring…";
	if (folder.messages === undefined) return "—";
	return `${formatMessageCount(folder.messages)} · ${formatBytes(folder.bytes ?? 0)}`;
}

const selectedCount = computed(
	() => folderMappings.value.filter((f) => f.selected).length,
);

const totalCount = computed(() => folderMappings.value.length);

const allSelected = computed(
	() => folderMappings.value.length > 0 && folderMappings.value.every((f) => f.selected),
);

const someSelected = computed(
	() => selectedCount.value > 0 && selectedCount.value < totalCount.value,
);

const selectAllCheckbox = ref<HTMLInputElement | null>(null);

watch(
	[someSelected, allSelected],
	() => {
		const input = selectAllCheckbox.value;
		if (input) input.indeterminate = someSelected.value;
	},
	{ flush: "post" },
);

const totalMessages = computed(() =>
	folderMappings.value.reduce((sum, f) => sum + (f.messages ?? 0), 0),
);

const totalBytes = computed(() =>
	folderMappings.value.reduce((sum, f) => sum + (f.bytes ?? 0), 0),
);

function allFoldersStatsLabel(): string {
	if (props.loadingStats) return "Measuring…";
	if (folderMappings.value.every((f) => f.messages === undefined)) {
		return `${totalCount.value} folders`;
	}
	return `${formatMessageCount(totalMessages.value)} · ${formatBytes(totalBytes.value)}`;
}

const selectedMessages = computed(() =>
	folderMappings.value
		.filter((f) => f.selected)
		.reduce((sum, f) => sum + (f.messages ?? 0), 0),
);

const selectedBytes = computed(() =>
	folderMappings.value
		.filter((f) => f.selected)
		.reduce((sum, f) => sum + (f.bytes ?? 0), 0),
);

const selectionSummary = computed(() => {
	if (props.loadingStats) return "Measuring folder sizes…";
	if (selectedCount.value === 0) return `${selectedCount.value} of ${totalCount.value} selected`;
	return `${selectedCount.value} folders · ${formatMessageCount(selectedMessages.value)} · ${formatBytes(selectedBytes.value)}`;
});

const durationEstimate = computed(() => {
	if (props.loadingStats || selectedCount.value === 0) return null;
	if (selectedMessages.value === 0 && selectedBytes.value === 0) return null;
	return estimateMigrationDuration({
		totalBytes: selectedBytes.value,
		messageCount: selectedMessages.value,
		sourceProvider: props.sourceProvider,
		destProvider: props.destProvider,
	});
});

const needsPaidPlan = computed(
	() =>
		!props.loadingStats &&
		selectedCount.value > 0 &&
		selectedBytes.value > 0 &&
		requiresPaidPlan(selectedBytes.value),
);

const dockLoading = computed(() => props.loadingStats || props.estimatingSize);

const startButtonLabel = computed(() => {
	if (props.loadingStats) return "Measuring…";
	if (props.estimatingSize) return "Checking…";

	const durationSuffix = durationEstimate.value
		? ` (~${formatDurationCompact(durationEstimate.value.secondsTypical)})`
		: "";

	if (needsPaidPlan.value) {
		const tier = pricing.tierForBytes(selectedBytes.value);
		return `Start migration · ${tier.priceLabel} once${durationSuffix}`;
	}

	return `Start migration${durationSuffix}`;
});

const canStart = computed(() => {
	if (selectedCount.value === 0 || props.estimatingSize || props.loadingStats) {
		return false;
	}
	if (localBackupEnabled.value && props.backupDiskError) return false;
	return true;
});

function toggleAll(selected: boolean) {
	for (const folder of folderMappings.value) {
		folder.selected = selected;
	}
}

function onSelectAllChange(event: Event) {
	toggleAll((event.target as HTMLInputElement).checked);
}
</script>

<template>
	<div class="setup-folders">
		<div class="folders-scroll">
			<SetupStepHero
				eyebrow="Step 2 of 2 · Folders"
				title="Choose folders to migrate"
				subline="Pick what should move."
				show-back
				@back="emit('back')"
			/>

			<MigrationPaidPlanNotice
				:selected-bytes="selectedBytes"
				:loading-stats="loadingStats"
				:has-selection="selectedCount > 0"
			/>

			<section class="backup-panel" aria-labelledby="backup-heading">
				<div class="backup-inner">
					<label class="backup-toggle">
						<input v-model="localBackupEnabled" type="checkbox" />
						<span class="backup-toggle-text">
							<span class="backup-title-row">
								<span id="backup-heading" class="backup-title">{{ BACKUP_COPY.panelTitle }}</span>
								<span class="backup-free-badge">{{ BACKUP_COPY.freeBadge }}</span>
							</span>
							<span class="backup-hint">{{ BACKUP_COPY.panelHint }}</span>
						</span>
					</label>
					<button
						v-if="localBackupEnabled"
						type="button"
						class="backup-pick-btn"
						:disabled="pickingBackupDir"
						@click="emit('pickBackupDir')"
					>
						{{ pickingBackupDir ? BACKUP_COPY.openingFolder : BACKUP_COPY.chooseFolder }}
					</button>
				</div>
			</section>

			<section class="folder-panel" aria-labelledby="folder-list-heading">
				<div class="folder-panel-top">
					<div>
						<h2 id="folder-list-heading">Mailbox folders</h2>
						<p class="folder-meta">{{ selectionSummary }}</p>
						<p v-if="statsError" class="folder-stats-error">
							{{ statsError }}
							<button type="button" class="retry-link" @click="emit('retryStats')">
								Retry
							</button>
						</p>
					</div>
				</div>

				<ul
					v-if="folderMappings.length"
					class="folder-list"
					:class="{ 'is-loading': loadingStats }"
				>
					<li class="folder-row-all-wrap">
						<label class="folder-row folder-row-all">
							<input
								ref="selectAllCheckbox"
								type="checkbox"
								:checked="allSelected"
								@change="onSelectAllChange"
							/>
							<span class="folder-main">
								<span class="folder-path">All folders</span>
							</span>
							<span class="folder-stats">{{ allFoldersStatsLabel() }}</span>
						</label>
					</li>
					<li v-for="folder in folderMappings" :key="folder.sourcePath">
						<label class="folder-row" :class="{ dim: !folder.selected }">
							<input v-model="folder.selected" type="checkbox" />
							<span class="folder-main">
								<span class="folder-path">{{ folder.sourcePath }}</span>
								<span
									v-if="folder.destPath !== folder.sourcePath"
									class="folder-dest-inline"
								>
									→ {{ folder.destPath }}
								</span>
							</span>
							<span class="folder-stats" :class="{ pending: loadingStats && folder.messages === undefined }">
								{{ folderStatsLabel(folder) }}
							</span>
						</label>
					</li>
				</ul>
				<p v-else class="folder-empty">No folders found on the source mailbox.</p>
			</section>
		</div>

		<AppDock
			:label="startButtonLabel"
			:disabled="!canStart"
			:loading="dockLoading"
			@action="emit('startMigration')"
		>
			<template v-if="estimateError || quotaWarning || backupDiskError" #top>
				<p v-if="estimateError" class="dock-error">{{ estimateError }}</p>
				<p v-else-if="backupDiskError && localBackupEnabled" class="dock-error">
					{{ backupDiskError }}
				</p>
				<p v-else-if="quotaWarning" class="dock-warning">{{ quotaWarning }}</p>
			</template>
		</AppDock>
	</div>
</template>

<style scoped>
.setup-folders {
	height: 100%;
	width: 100%;
	align-self: stretch;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.folders-scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.65rem;
	padding: 0 0 var(--app-dock-h-hover);
	scrollbar-width: thin;
}

.backup-panel {
	padding: 0.85rem 1rem;
	background: linear-gradient(135deg, rgba(13, 148, 136, 0.06) 0%, var(--surface) 55%);
	border: 1px solid rgba(13, 148, 136, 0.22);
	border-radius: 16px;
	box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
}

.backup-inner {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}

.backup-toggle {
	display: flex;
	align-items: center;
	gap: 0.65rem;
	flex: 1;
	min-width: 0;
	cursor: pointer;
}

.backup-toggle input {
	flex-shrink: 0;
	margin: 0;
	accent-color: var(--accent, #0d9488);
}

.backup-toggle-text {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	min-width: 0;
}

.backup-title-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.4rem;
}

.backup-title {
	font-size: 0.88rem;
	font-weight: 700;
	letter-spacing: -0.02em;
}

.backup-free-badge {
	font-size: 0.62rem;
	font-weight: 800;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	padding: 0.15rem 0.45rem;
	border-radius: 999px;
	background: rgba(13, 148, 136, 0.14);
	color: #0f766e;
}

.backup-hint {
	font-size: 0.72rem;
	color: var(--muted);
	line-height: 1.4;
}

.backup-pick-btn {
	flex-shrink: 0;
	align-self: center;
	font-size: 0.72rem;
	font-weight: 600;
	padding: 0.35rem 0.65rem;
	border-radius: 8px;
	border: 1px solid var(--border);
	background: var(--surface-elevated, #fff);
	cursor: pointer;
	white-space: nowrap;
}

.backup-pick-btn:disabled {
	opacity: 0.6;
	cursor: wait;
}

.folder-panel {
	flex: 1;
	min-height: 12rem;
	display: flex;
	flex-direction: column;
	padding: 0.85rem 1rem;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 16px;
	box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
}

.folder-panel-top {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.75rem;
	margin-bottom: 0.65rem;
}

.folder-panel-top h2 {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 800;
	letter-spacing: -0.02em;
}

.folder-meta {
	margin: 0.2rem 0 0;
	font-size: 0.75rem;
	color: var(--muted);
}

.folder-stats-error {
	margin: 0.35rem 0 0;
	font-size: 0.72rem;
	color: #b91c1c;
}

.retry-link {
	margin-left: 0.35rem;
	padding: 0;
	border: none;
	background: none;
	font-size: inherit;
	font-weight: 700;
	color: inherit;
	text-decoration: underline;
	cursor: pointer;
}

.folder-list {
	list-style: none;
	margin: 0;
	padding: 0;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	border: 1px solid var(--border);
	border-radius: 12px;
	background: var(--bg);
	scrollbar-width: thin;
}

.folder-list.is-loading {
	opacity: 0.92;
}

.folder-row {
	display: flex;
	align-items: center;
	gap: 0.55rem;
	padding: 0.5rem 0.65rem;
	border-bottom: 1px solid var(--border);
	cursor: pointer;
	transition: background 0.12s ease;
}

.folder-row-all-wrap {
	border-bottom: 1.5px solid var(--border);
}

.folder-row-all {
	background: rgba(0, 0, 0, 0.02);
}

.folder-row-all .folder-path {
	font-weight: 800;
}

.folder-row:last-child {
	border-bottom: none;
}

.folder-row:hover {
	background: rgba(0, 0, 0, 0.03);
}

.folder-row.dim {
	opacity: 0.55;
}

.folder-row input {
	width: 1rem;
	height: 1rem;
	accent-color: var(--fg);
	flex-shrink: 0;
}

.folder-main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.1rem;
}

.folder-path {
	font-size: 0.82rem;
	font-weight: 600;
	min-width: 0;
	word-break: break-word;
}

.folder-dest-inline {
	font-size: 0.68rem;
	color: var(--muted);
}

.folder-stats {
	flex-shrink: 0;
	font-size: 0.68rem;
	font-weight: 600;
	color: var(--muted);
	text-align: right;
	white-space: nowrap;
}

.folder-stats.pending {
	font-style: italic;
	opacity: 0.7;
}

.folder-empty {
	margin: 0;
	padding: 1.5rem;
	text-align: center;
	font-size: 0.85rem;
	color: var(--muted);
}

</style>
