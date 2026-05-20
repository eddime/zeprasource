<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
	sourceReady: boolean;
	destReady: boolean;
}>();

const bothReady = computed(() => props.sourceReady && props.destReady);
</script>

<template>
	<div
		class="flow-bridge"
		:class="{
			'source-ready': sourceReady,
			'dest-ready': destReady,
			complete: bothReady,
		}"
		aria-hidden="true"
	>
		<span class="flow-track flow-track--in" />
		<div class="flow-hub">
			<svg class="flow-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M4.5 12h12M13.5 8.25 17.25 12 13.5 15.75"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<path
					d="M17.25 8.25v7.5"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					opacity="0.35"
				/>
			</svg>
		</div>
		<span class="flow-track flow-track--out" />
	</div>
</template>

<style scoped>
.flow-bridge {
	--flow-muted: var(--border);
	--flow-active: var(--fg);
	--flow-done: #7fa878;
	display: flex;
	flex-direction: row;
	align-items: center;
	justify-content: center;
	width: 4.25rem;
	flex-shrink: 0;
	align-self: center;
	padding: 0 0.15rem;
}

.flow-track {
	flex: 1;
	height: 2px;
	border-radius: 999px;
	background: var(--flow-muted);
	transition:
		background 0.35s ease,
		transform 0.35s ease;
}

.flow-track--in {
	transform-origin: right center;
}

.flow-track--out {
	transform-origin: left center;
}

.flow-bridge.source-ready .flow-track--in {
	background: linear-gradient(90deg, var(--flow-muted) 0%, var(--flow-active) 100%);
	transform: scaleX(1.05);
}

.flow-bridge.dest-ready .flow-track--out {
	background: linear-gradient(90deg, var(--flow-active) 0%, var(--flow-muted) 100%);
}

.flow-bridge.complete .flow-track--in {
	background: linear-gradient(90deg, var(--flow-muted) 0%, var(--flow-done) 100%);
}

.flow-bridge.complete .flow-track--out {
	background: linear-gradient(90deg, var(--flow-done) 0%, var(--flow-done) 100%);
}

.flow-hub {
	flex-shrink: 0;
	width: 2.65rem;
	height: 2.65rem;
	display: grid;
	place-items: center;
	border-radius: 50%;
	border: 1.5px solid var(--border);
	background: var(--surface);
	color: var(--muted);
	box-shadow:
		0 1px 0 rgba(255, 255, 255, 0.9) inset,
		0 6px 20px rgba(0, 0, 0, 0.06);
	transition:
		border-color 0.3s ease,
		color 0.3s ease,
		background 0.3s ease,
		box-shadow 0.3s ease,
		transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.flow-icon {
	width: 1.15rem;
	height: 1.15rem;
}

.flow-bridge.source-ready .flow-hub {
	border-color: color-mix(in srgb, var(--fg) 40%, var(--border));
	color: var(--fg);
}

.flow-bridge.dest-ready .flow-hub {
	transform: scale(1.04);
}

.flow-bridge.complete .flow-hub {
	border-color: #8aad82;
	background: #f4f8f2;
	color: #2d3d2a;
	box-shadow:
		0 0 0 3px rgba(127, 168, 120, 0.18),
		0 8px 24px rgba(45, 61, 42, 0.1);
}

@media (prefers-reduced-motion: reduce) {
	.flow-bridge.dest-ready .flow-hub {
		transform: none;
	}
}
</style>
