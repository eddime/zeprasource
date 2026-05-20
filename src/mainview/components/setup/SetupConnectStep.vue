<script setup lang="ts">
import { computed } from "vue";
import type { MailboxCredentials } from "../../../shared/types";
import ZebraMascot from "../zebra/ZebraMascot.vue";
import MailboxCard from "../mailbox/MailboxCard.vue";
import LocalTestServersPanel from "../mailbox/LocalTestServersPanel.vue";
import AppDock from "../ui/AppDock.vue";

const source = defineModel<MailboxCredentials>("source", { required: true });
const destination = defineModel<MailboxCredentials>("destination", { required: true });

const props = defineProps<{
	subline: string;
	sourceValidated: boolean;
	destValidated: boolean;
	testingSource: boolean;
	testingDest: boolean;
	sourceTestError: string | null;
	destTestError: string | null;
}>();

const emit = defineEmits<{
	verifySource: [];
	verifyDest: [];
	applySource: [];
	applyDest: [];
	applyCloud: [];
	continue: [];
}>();

const stepsComplete = computed(
	() => props.sourceValidated && props.destValidated,
);

const ctaLabel = computed(() => (stepsComplete.value ? "Choose folders" : "Almost there"));
</script>

<template>
	<div class="setup-connect">
		<div class="setup-scroll">
		<header class="hero">
			<div class="hero-zebra">
				<div class="zebra-mask">
					<div class="zebra-riser">
						<ZebraMascot state="idle" :size="200" class="hero-zebra-img" />
					</div>
				</div>
			</div>
			<div class="hero-copy">
				<p class="eyebrow">Step 1 of 2 · Connect</p>
				<h1 class="hero-title">Connect your mailboxes</h1>
				<p class="hero-sub">{{ subline }}</p>

				<div class="step-track" aria-label="Connection progress">
					<div class="step-pill" :class="{ done: sourceValidated }">
						<span class="step-num">1</span>
						<span>Source</span>
					</div>
					<div class="step-line" :class="{ active: sourceValidated }" />
					<div class="step-pill" :class="{ done: destValidated }">
						<span class="step-num">2</span>
						<span>Destination</span>
					</div>
				</div>
			</div>
		</header>

		<LocalTestServersPanel
			class="test-panel"
			@apply-source="emit('applySource')"
			@apply-dest="emit('applyDest')"
			@apply-cloud="emit('applyCloud')"
		/>

		<div class="mailbox-stage">
			<MailboxCard
				v-model:credentials="source"
				class="mailbox-card"
				:step="1"
				title="From"
				subtitle="Where your mail lives today"
				:validated="sourceValidated"
				:testing="testingSource"
				:error="sourceTestError"
				@verify="emit('verifySource')"
			/>

			<div class="flow-bridge" aria-hidden="true">
				<svg viewBox="0 0 48 120" fill="none" class="flow-svg">
					<path
						d="M24 4v40M24 76v40"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-dasharray="5 6"
					/>
					<circle cx="24" cy="60" r="22" fill="var(--surface)" stroke="currentColor" stroke-width="2" />
					<path
						d="M16 60h16M28 52l8 8-8 8"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</div>

			<MailboxCard
				v-model:credentials="destination"
				class="mailbox-card"
				:step="2"
				title="To"
				subtitle="Where your mail should land"
				:validated="destValidated"
				:testing="testingDest"
				:error="destTestError"
				@verify="emit('verifyDest')"
			/>
		</div>
		</div>

		<AppDock :label="ctaLabel" :disabled="!stepsComplete" @action="emit('continue')" />
	</div>
</template>

<style scoped>
.setup-connect {
	height: 100%;
	width: 100%;
	align-self: stretch;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.setup-scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.65rem;
	width: 100%;
	max-width: 100%;
	margin: 0 auto;
	padding: 0 0 var(--app-dock-h-hover);
	scrollbar-width: thin;
}

.hero {
	flex-shrink: 0;
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.5rem 1.75rem;
	align-items: stretch;
	padding: 1rem 1.35rem;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 20px;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
	background-image: radial-gradient(
		circle at 100% 0%,
		rgba(0, 0, 0, 0.04) 0%,
		transparent 42%
	);
	overflow: visible;
}

.hero-zebra {
	flex-shrink: 0;
	overflow: visible;
	align-self: stretch;
	display: flex;
	align-items: flex-end;
	justify-content: center;
}

/* Clip only the bottom edge; sides stay visible (negative inset expands clip box). */
.zebra-mask {
	position: relative;
	flex-shrink: 0;
	width: 12.5rem;
	height: 100%;
	min-height: 9.5rem;
	max-height: 10.5rem;
	overflow: visible;
	clip-path: inset(-1.25rem -4rem 0 -4rem);
	-webkit-clip-path: inset(-1.25rem -4rem 0 -4rem);
}

.zebra-riser {
	position: absolute;
	left: 50%;
	bottom: 0;
	width: max-content;
	transform: translateX(-50%) translateY(82%);
	animation: hero-zebra-peek 2.2s ease-in-out forwards;
	will-change: transform;
}

.hero-zebra-img :deep(.zebra-wrap) {
	overflow: visible;
}

.hero-zebra-img :deep(.variant-connect .zebra-img) {
	width: 100%;
	height: 100%;
	object-position: center bottom;
}

@keyframes hero-zebra-peek {
	0% {
		transform: translateX(-50%) translateY(82%);
	}

	28% {
		transform: translateX(-50%) translateY(6%);
		animation-timing-function: cubic-bezier(0.22, 1.2, 0.36, 1);
	}

	36% {
		transform: translateX(-50%) translateY(-5%);
	}

	44% {
		transform: translateX(-50%) translateY(1.5%);
	}

	52%,
	100% {
		transform: translateX(-50%) translateY(0%);
	}
}

@media (prefers-reduced-motion: reduce) {
	.zebra-riser {
		animation: none;
		transform: translateX(-50%) translateY(0%);
	}
}

.hero-copy {
	min-width: 0;
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
	font-size: 1.85rem;
	font-weight: 800;
	letter-spacing: -0.035em;
	line-height: 1.05;
	color: var(--fg);
}

.hero-sub {
	margin: 0.4rem 0 0;
	font-size: 0.92rem;
	line-height: 1.45;
	color: var(--muted);
	max-width: 34rem;
}

.step-track {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-top: 0.85rem;
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
	transition:
		border-color 0.2s ease,
		background 0.2s ease,
		color 0.2s ease;
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
	background: var(--border);
	transition: background 0.25s ease;
}

.step-line.active {
	background: var(--fg);
}

.test-panel {
	flex-shrink: 0;
}

.mailbox-stage {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-columns: 1fr auto 1fr;
	gap: 0.5rem;
	align-items: stretch;
}

.mailbox-card {
	min-height: 0;
	overflow-y: auto;
	scrollbar-width: thin;
}

.flow-bridge {
	display: flex;
	align-items: center;
	justify-content: center;
	align-self: center;
	color: var(--muted);
}

.flow-svg {
	width: 44px;
	height: 72px;
}

</style>
