<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { FolderMapping } from "../../../shared/types";
import { formatBytes } from "../../../shared/pricing";
import ZebraMascot from "../zebra/ZebraMascot.vue";
import AppDock from "../ui/AppDock.vue";

const folderMappings = defineModel<FolderMapping[]>("folderMappings", { required: true });

const props = defineProps<{
	sourceEmail: string;
	destEmail: string;
	loadingStats: boolean;
	statsError: string | null;
	estimatingSize: boolean;
	estimateError: string | null;
	quotaWarning: string | null;
}>();

const emit = defineEmits<{
	back: [];
	retryStats: [];
	startMigration: [];
}>();

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

const canStart = computed(
	() => selectedCount.value > 0 && !props.estimatingSize && !props.loadingStats,
);

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
			<header class="hero">
				<div class="hero-zebra">
					<ZebraMascot state="idle" :size="120" class="hero-zebra-img" />
				</div>
				<div class="hero-copy">
					<button type="button" class="hero-back" @click="emit('back')">
						← Back to mailboxes
					</button>
					<p class="eyebrow">Step 2 of 2</p>
					<h1 class="hero-title">Choose folders to migrate</h1>
					<p class="hero-sub">
						From <strong>{{ sourceEmail || "source" }}</strong> to
						<strong>{{ destEmail || "destination" }}</strong> — pick what should move.
					</p>
					<div class="step-track" aria-label="Setup progress">
						<div class="step-pill done">
							<span class="step-num">✓</span>
							<span>Connected</span>
						</div>
						<div class="step-line active" />
						<div class="step-pill done">
							<span class="step-num">2</span>
							<span>Folders</span>
						</div>
					</div>
				</div>
			</header>

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
			label="Start migration"
			:disabled="!canStart"
			:loading="estimatingSize"
			@action="emit('startMigration')"
		>
			<template v-if="estimateError || quotaWarning" #top>
				<p v-if="estimateError" class="dock-error">{{ estimateError }}</p>
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

.hero {
	flex-shrink: 0;
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.5rem 1.25rem;
	align-items: center;
	padding: 1rem 1.35rem;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 20px;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
}

.hero-zebra {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
}

.hero-copy {
	min-width: 0;
}

.hero-back {
	display: inline-block;
	margin: 0 0 0.35rem;
	padding: 0;
	border: none;
	background: none;
	font-size: 0.72rem;
	font-weight: 600;
	color: var(--muted);
	cursor: pointer;
}

.hero-back:hover {
	color: var(--fg);
}

.eyebrow {
	margin: 0;
	font-size: 0.72rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.12em;
	color: var(--muted);
}

.hero-title {
	margin: 0.35rem 0 0;
	font-size: 1.65rem;
	font-weight: 800;
	letter-spacing: -0.035em;
	line-height: 1.05;
}

.hero-sub {
	margin: 0.4rem 0 0;
	font-size: 0.9rem;
	line-height: 1.45;
	color: var(--muted);
	max-width: 34rem;
}

.hero-sub strong {
	color: var(--fg);
	font-weight: 700;
}

.step-track {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-top: 0.75rem;
}

.step-pill {
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0.3rem 0.65rem 0.3rem 0.3rem;
	border-radius: var(--radius-pill);
	border: 1.5px solid var(--border);
	background: var(--bg);
	font-size: 0.72rem;
	font-weight: 700;
	color: var(--muted);
}

.step-pill.done {
	border-color: var(--fg);
	background: var(--fg);
	color: #fff;
}

.step-num {
	width: 1.35rem;
	height: 1.35rem;
	border-radius: 50%;
	display: grid;
	place-items: center;
	font-size: 0.68rem;
	font-weight: 800;
	background: rgba(0, 0, 0, 0.08);
}

.step-pill.done .step-num {
	background: rgba(255, 255, 255, 0.2);
}

.step-line {
	flex: 1;
	max-width: 3rem;
	height: 2px;
	border-radius: 1px;
	background: var(--fg);
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
