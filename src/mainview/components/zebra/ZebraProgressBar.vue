<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		percent: number;
		label?: string;
		animated?: boolean;
		/** Percent to the right of the track (session cards). Default: above track (runner). */
		percentBeside?: boolean;
	}>(),
	{ percent: 0, label: "", animated: true, percentBeside: false },
);

const clamped = computed(() => Math.min(100, Math.max(0, props.percent)));
</script>

<template>
	<div
		class="zebra-progress"
		:class="{ 'zebra-progress--percent-beside': percentBeside }"
		role="progressbar"
		:aria-valuenow="clamped"
		aria-valuemin="0"
		aria-valuemax="100"
	>
		<div class="progress-core">
			<p class="pct-display">{{ Math.round(clamped) }}<span class="pct-suffix">%</span></p>
			<div class="track">
				<div class="track-stripes" aria-hidden="true" />
				<div class="fill" :class="{ animated }" :style="{ width: `${clamped}%` }">
					<div class="fill-pattern" aria-hidden="true" />
					<div class="fill-pattern fill-pattern--offset" aria-hidden="true" />
					<div class="fill-gloss" aria-hidden="true" />
				</div>
			</div>
		</div>
		<p v-if="label" class="label">{{ label }}</p>
	</div>
</template>

<style scoped>
.zebra-progress {
	--stripe-angle: 108deg;
	--stripe-period: 34px;
	--zebra-ink: #0a0a0a;
	--zebra-paper: #f6f6f6;
	width: 100%;
	max-width: 960px;
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 0.65rem;
}

.progress-core {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 0.65rem;
	width: 100%;
}

.zebra-progress--percent-beside {
	gap: 0.45rem;
}

.zebra-progress--percent-beside .progress-core {
	flex-direction: row;
	align-items: center;
	gap: 0.5rem;
}

.zebra-progress--percent-beside .track {
	flex: 1;
	min-width: 0;
	order: 1;
}

.zebra-progress--percent-beside .pct-display {
	order: 2;
	flex-shrink: 0;
	text-align: right;
	font-size: clamp(1.35rem, 2.8vw, 1.85rem);
}

.pct-display {
	margin: 0;
	font-size: clamp(2.5rem, 5vw, 3.5rem);
	font-weight: 800;
	letter-spacing: -0.05em;
	line-height: 1;
	font-variant-numeric: tabular-nums;
	text-align: center;
	color: var(--fg);
}

.pct-suffix {
	font-size: 0.42em;
	font-weight: 600;
	color: var(--muted);
	margin-left: 0.05em;
}

.track {
	position: relative;
	height: 24px;
	border-radius: 999px;
	background: var(--zebra-paper);
	overflow: hidden;
	border: 1px solid rgba(0, 0, 0, 0.1);
	box-shadow:
		inset 0 2px 4px rgba(0, 0, 0, 0.06),
		0 1px 0 rgba(255, 255, 255, 0.9);
}

.track-stripes {
	position: absolute;
	inset: 0;
	opacity: 0.35;
	background-image: repeating-linear-gradient(
		var(--stripe-angle),
		rgba(0, 0, 0, 0.07) 0,
		rgba(0, 0, 0, 0.07) 5px,
		transparent 5px,
		transparent 11px,
		rgba(0, 0, 0, 0.05) 11px,
		rgba(0, 0, 0, 0.05) 17px,
		transparent 17px,
		transparent 24px
	);
	background-size: var(--stripe-period) 100%;
}

.fill {
	position: relative;
	z-index: 1;
	height: 100%;
	min-width: 0;
	border-radius: 999px;
	overflow: hidden;
	background: var(--zebra-ink);
	box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
	transition: width 0.55s cubic-bezier(0.22, 1, 0.36, 1);
}

.fill-pattern {
	position: absolute;
	inset: -2px -4px;
	background-image: repeating-linear-gradient(
		var(--stripe-angle),
		var(--zebra-ink) 0,
		var(--zebra-ink) 7px,
		#f0f0f0 7px,
		#f0f0f0 12px,
		var(--zebra-ink) 12px,
		var(--zebra-ink) 21px,
		#ececec 21px,
		#ececec 27px,
		var(--zebra-ink) 27px,
		var(--zebra-ink) 34px
	);
	background-size: var(--stripe-period) 140%;
}

.fill-pattern--offset {
	opacity: 0.45;
	background-image: repeating-linear-gradient(
		var(--stripe-angle),
		transparent 0,
		transparent 4px,
		rgba(255, 255, 255, 0.2) 4px,
		rgba(255, 255, 255, 0.2) 9px,
		transparent 9px,
		transparent 16px
	);
	mix-blend-mode: soft-light;
}

.fill.animated .fill-pattern {
	animation: zebra-march 1.1s linear infinite;
}

.fill.animated .fill-pattern--offset {
	animation: zebra-march 1.1s linear infinite reverse;
}

.fill-gloss {
	position: absolute;
	inset: 0;
	background: linear-gradient(
		180deg,
		rgba(255, 255, 255, 0.28) 0%,
		rgba(255, 255, 255, 0.06) 38%,
		transparent 55%,
		rgba(0, 0, 0, 0.12) 100%
	);
	pointer-events: none;
}

.fill.animated .fill-gloss::after {
	content: "";
	position: absolute;
	inset: 0;
	background: linear-gradient(
		105deg,
		transparent 0%,
		transparent 40%,
		rgba(255, 255, 255, 0.35) 50%,
		transparent 60%,
		transparent 100%
	);
	background-size: 200% 100%;
	animation: zebra-sheen 2.4s ease-in-out infinite;
}

.label {
	margin: 0;
	font-size: 0.9rem;
	font-weight: 500;
	color: var(--muted);
	text-align: center;
}

@keyframes zebra-march {
	from {
		background-position: 0 0;
	}
	to {
		background-position: var(--stripe-period) 0;
	}
}

@keyframes zebra-sheen {
	0% {
		background-position: 130% 0;
	}
	100% {
		background-position: -130% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.fill-pattern,
	.fill-gloss::after {
		animation: none !important;
	}
}
</style>
