<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		percent: number;
		size?: number;
		stroke?: number;
		label?: string;
	}>(),
	{ size: 180, stroke: 10, percent: 0 },
);

const radius = computed(() => (props.size - props.stroke) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const offset = computed(
	() =>
		circumference.value -
		(Math.min(100, Math.max(0, props.percent)) / 100) * circumference.value,
);
</script>

<template>
	<div class="ring-wrap" :style="{ width: `${size}px`, height: `${size}px` }">
		<svg :width="size" :height="size" class="ring">
			<circle
				class="track"
				:cx="size / 2"
				:cy="size / 2"
				:r="radius"
				:stroke-width="stroke"
			/>
			<circle
				class="progress"
				:cx="size / 2"
				:cy="size / 2"
				:r="radius"
				:stroke-width="stroke"
				:stroke-dasharray="circumference"
				:stroke-dashoffset="offset"
			/>
		</svg>
		<div class="center">
			<strong>{{ Math.round(percent) }}%</strong>
			<span v-if="label">{{ label }}</span>
		</div>
	</div>
</template>

<style scoped>
.ring-wrap {
	position: relative;
	display: grid;
	place-items: center;
}
.ring {
	transform: rotate(-90deg);
}
.track {
	fill: none;
	stroke: var(--surface-muted);
}
.progress {
	fill: none;
	stroke: var(--accent);
	stroke-linecap: round;
	transition: stroke-dashoffset 0.35s ease;
}
.center {
	position: absolute;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.15rem;
}
.center strong {
	font-size: 2rem;
	font-weight: 600;
	letter-spacing: -0.04em;
}
.center span {
	font-size: 0.75rem;
	color: var(--muted);
}
</style>
