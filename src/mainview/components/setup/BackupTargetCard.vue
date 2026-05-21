<script setup lang="ts">
import { computed } from "vue";
import { BACKUP_COPY } from "../../../shared/backup-copy";

const backupParentDir = defineModel<string>("backupParentDir", { required: true });

const props = defineProps<{
	ready: boolean;
	picking: boolean;
	diskError: string | null;
}>();

const emit = defineEmits<{ pickDir: [] }>();

const displayError = computed(() => props.diskError);
</script>

<template>
	<article class="card card--to" :class="{ ok: ready, 'is-connected': ready }">
		<header v-if="!ready" class="card-top">
			<div class="card-identity">
				<span class="role-badge">To</span>
				<p class="card-sub">{{ BACKUP_COPY.targetCardSub }}</p>
			</div>
		</header>

		<div class="card-main">
			<div class="card-body">
				<div class="card-pane">
					<p class="field-label">Save location</p>
					<p class="path-display" :class="{ empty: !backupParentDir.trim() }">
						{{ backupParentDir.trim() || BACKUP_COPY.targetPathPlaceholder }}
					</p>
				</div>
			</div>

			<footer class="card-foot">
				<p v-if="displayError" class="verify-error" role="alert">{{ displayError }}</p>
				<button
					type="button"
					class="verify-btn is-idle"
					:disabled="picking"
					@click="emit('pickDir')"
				>
					<span class="verify-text">
						{{ picking ? BACKUP_COPY.openingFolder : BACKUP_COPY.chooseFolder }}
					</span>
				</button>
			</footer>
		</div>

		<Transition name="connected">
			<div
				v-if="ready"
				class="connected-overlay"
				role="status"
				aria-label="Backup folder selected"
			>
				<div class="connected-content">
					<p class="connected-role">To</p>
					<span class="connected-check" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none">
							<path
								d="M8 12.2 10.6 14.8 16 9.4"
								stroke="currentColor"
								stroke-width="2.25"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</span>
					<p class="connected-title">Folder ready</p>
					<p class="connected-email path-on-overlay">{{ backupParentDir }}</p>
					<button type="button" class="connected-change-btn" @click="emit('pickDir')">
						Choose another folder
					</button>
				</div>
			</div>
		</Transition>
	</article>
</template>

<style scoped>
.card {
	position: relative;
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 20px;
	overflow: hidden;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
	transition:
		border-color 0.25s ease,
		box-shadow 0.25s ease;
}

.card.ok:not(.is-connected) {
	border-color: var(--fg);
	box-shadow: 0 0 0 1px var(--fg);
}

.card.is-connected {
	border-color: #8aad82;
	box-shadow:
		0 0 0 2px rgba(138, 173, 130, 0.35),
		0 8px 32px rgba(95, 122, 89, 0.1);
}

.card-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.5rem 0.7rem;
	border-bottom: 1px solid var(--border);
	background: var(--surface);
}

.card-identity {
	display: flex;
	align-items: baseline;
	gap: 0.45rem;
	min-width: 0;
	flex: 1;
	flex-wrap: wrap;
}

.role-badge {
	flex-shrink: 0;
	font-family: var(--font-display);
	font-size: 1rem;
	font-weight: 800;
	letter-spacing: -0.03em;
	line-height: 1.1;
	color: var(--fg);
}

.card-sub {
	margin: 0;
	font-size: 0.68rem;
	line-height: 1.3;
	color: var(--muted);
}

.card-main {
	position: relative;
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.card-body {
	flex: 1;
	min-height: 0;
	padding: 0.65rem 0.85rem 0.55rem;
	overflow-x: hidden;
	overflow-y: auto;
}

.card-pane {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.field-label {
	margin: 0;
	font-size: 0.72rem;
	font-weight: 700;
	color: var(--muted);
	letter-spacing: 0.02em;
}

.path-display {
	margin: 0;
	padding: 0.5rem 0.65rem;
	border-radius: 12px;
	font-size: 0.78rem;
	line-height: 1.45;
	word-break: break-all;
	color: var(--fg);
	background: #fff;
	border: 1px solid var(--border);
}

.path-display.empty {
	color: var(--muted);
	font-style: italic;
	background: var(--bg);
}

.card-foot {
	flex-shrink: 0;
	padding: 0.55rem 0.85rem 0.75rem;
	border-top: 1px solid var(--border);
	background: #fafafa;
}

.verify-error {
	margin: 0 0 0.65rem;
	padding: 0.55rem 0.7rem;
	font-size: 0.78rem;
	line-height: 1.4;
	color: #9f1239;
	background: rgba(159, 18, 57, 0.08);
	border: 1px solid rgba(159, 18, 57, 0.2);
	border-radius: 10px;
}

.verify-btn {
	width: 100%;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.45rem;
	padding: 0.62rem 0.85rem;
	border-radius: 12px;
	border: 1.5px solid transparent;
	font-family: var(--font-display);
	font-size: 0.8125rem;
	font-weight: 700;
	letter-spacing: -0.02em;
	line-height: 1.2;
	cursor: pointer;
	transition:
		background 0.2s ease,
		border-color 0.2s ease,
		color 0.2s ease,
		transform 0.15s ease,
		box-shadow 0.2s ease;
}

.verify-btn.is-idle {
	background: var(--fg);
	color: #fff;
	border-color: var(--fg);
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.verify-btn.is-idle:hover:not(:disabled) {
	transform: translateY(-1px);
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
}

.verify-btn:disabled {
	cursor: wait;
}

.connected-overlay {
	position: absolute;
	inset: 0;
	z-index: 6;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem 0.85rem;
	border-radius: inherit;
	background: color-mix(in srgb, var(--surface) 94%, transparent);
	backdrop-filter: blur(12px);
}

.connected-content {
	width: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	gap: 0.35rem;
}

.connected-role {
	margin: 0;
	font-family: var(--font-display);
	font-size: 0.9rem;
	font-weight: 800;
	color: var(--muted);
}

.connected-check {
	width: 2.5rem;
	height: 2.5rem;
	border-radius: 50%;
	display: grid;
	place-items: center;
	background: #8aad82;
	color: #fff;
}

.connected-check svg {
	width: 1.35rem;
	height: 1.35rem;
}

.connected-title {
	margin: 0;
	font-family: var(--font-display);
	font-size: 1.1rem;
	font-weight: 800;
	color: var(--fg);
}

.path-on-overlay {
	margin: 0;
	max-width: 100%;
	font-size: 0.75rem;
	line-height: 1.4;
	word-break: break-all;
	color: var(--muted);
}

.connected-change-btn {
	margin-top: 0.35rem;
	padding: 0;
	border: none;
	background: none;
	font-size: 0.78rem;
	font-weight: 700;
	color: var(--fg);
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
}

.connected-enter-active,
.connected-leave-active {
	transition: opacity 0.28s ease;
}

.connected-enter-from,
.connected-leave-to {
	opacity: 0;
}
</style>
