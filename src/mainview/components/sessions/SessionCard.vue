<script setup lang="ts">
import { computed } from "vue";
import ZebraProgressBar from "../zebra/ZebraProgressBar.vue";
import type { SessionCardModel, SessionCardStatus } from "../../../shared/migration-sessions";

const props = defineProps<{
	session: SessionCardModel;
	selected?: boolean;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const statusLabel = computed(() => {
	const map: Record<SessionCardStatus, string> = {
		running: "Running",
		paused: "Paused",
		failed: "Failed",
		completed: "Done",
		cancelled: "Cancelled",
	};
	return map[props.session.status];
});

const isActive = computed(() =>
	["running", "paused", "failed"].includes(props.session.status),
);

const progressPercent = computed(() =>
	Math.min(100, Math.max(0, props.session.percent ?? 0)),
);

const progressAnimated = computed(() => props.session.status === "running");

function shortEmail(email: string): string {
	const at = email.indexOf("@");
	if (at <= 0) return email.length > 18 ? `${email.slice(0, 17)}…` : email;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	const shortLocal = local.length > 13 ? `${local.slice(0, 12)}…` : local;
	const shortDomain = domain.length > 15 ? `${domain.slice(0, 14)}…` : domain;
	return `${shortLocal}@${shortDomain}`;
}
</script>

<template>
	<button
		type="button"
		class="session-card"
		:class="{ 'session-card--selected': selected }"
		@click="emit('select', session.id)"
	>
		<span class="session-badge">{{ statusLabel }}</span>

		<div class="session-mails">
			<p class="session-from" :title="session.sourceEmail">
				{{ shortEmail(session.sourceEmail) }}
			</p>
			<p class="session-to" :title="session.destEmail">
				→ {{ shortEmail(session.destEmail) }}
			</p>
		</div>

		<div v-if="isActive" class="session-progress-scaler" aria-hidden="true">
			<div class="session-progress-scaler-inner">
				<ZebraProgressBar
					percent-beside
					:percent="progressPercent"
					:animated="progressAnimated"
				/>
			</div>
		</div>
		<p v-else-if="session.meta" class="session-meta">{{ session.meta }}</p>
	</button>
</template>

<style scoped>
/* Align with pricing .plan cards — surface, border, soft shadow only */
.session-card {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 0.4rem;
	width: 100%;
	min-height: var(--session-card-slot, 6.85rem);
	box-sizing: border-box;
	padding: 0.6rem 0.65rem 0.55rem;
	border: 1px solid var(--border);
	border-radius: 1.15rem;
	background: var(--surface);
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.04);
	cursor: pointer;
	text-align: left;
	font-family: var(--font-sans);
	transition:
		border-color 0.2s ease,
		box-shadow 0.2s ease,
		transform 0.2s ease;
}

.session-card:hover {
	transform: translateY(-1px);
	border-color: #d4d4d4;
	box-shadow: 0 12px 36px rgba(0, 0, 0, 0.06);
}

.session-card--selected {
	border-color: var(--fg);
	box-shadow: var(--shadow-soft);
}

.session-badge {
	align-self: flex-start;
	display: inline-block;
	padding: 0.18rem 0.45rem;
	border-radius: var(--radius-pill);
	font-size: 0.6rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--muted);
	background: var(--btn-secondary);
	line-height: 1.2;
}

.session-mails {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
	min-width: 0;
}

.session-from {
	margin: 0;
	font-family: var(--font-display);
	font-size: 0.75rem;
	font-weight: 700;
	line-height: 1.2;
	letter-spacing: -0.02em;
	color: var(--fg);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.session-to {
	margin: 0;
	font-size: 0.6875rem;
	line-height: 1.3;
	color: var(--muted-light);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.session-progress-scaler {
	--session-progress-scale: 0.338;
	--session-progress-row-h: 32px;
	margin-top: auto;
	width: 100%;
	height: calc(var(--session-progress-row-h) * var(--session-progress-scale));
	overflow: visible;
	pointer-events: none;
	position: relative;
}

.session-progress-scaler-inner {
	position: absolute;
	top: 0;
	left: 0;
	width: calc(100% / var(--session-progress-scale));
	height: var(--session-progress-row-h);
	transform: scale(var(--session-progress-scale));
	transform-origin: top left;
}

.session-progress-scaler-inner :deep(.zebra-progress) {
	width: 100%;
	max-width: none;
}

.session-progress-scaler-inner :deep(.zebra-progress--percent-beside .pct-display) {
	font-size: clamp(2.15rem, 4.2vw, 2.75rem);
	min-width: 3.25rem;
	padding-left: 0.2rem;
}

.session-meta {
	margin: auto 0 0;
	font-size: 0.6875rem;
	color: var(--muted-light);
	line-height: 1.3;
}

@media (prefers-reduced-motion: reduce) {
	.session-card:hover {
		transform: none;
	}
}
</style>
