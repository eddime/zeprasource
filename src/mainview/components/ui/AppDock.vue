<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import AppButton from "./AppButton.vue";
import DockIcon from "./DockIcon.vue";

const props = withDefaults(
	defineProps<{
		label: string;
		disabled?: boolean;
		loading?: boolean;
	}>(),
	{ disabled: false, loading: false },
);

defineEmits<{ action: [] }>();

const isInactive = computed(() => props.disabled || props.loading);
const isReady = computed(() => !isInactive.value);

const showReadyPulse = ref(false);
let readyPulseTimer: ReturnType<typeof setTimeout> | null = null;

watch(isInactive, (inactive, wasInactive) => {
	if (wasInactive !== true || inactive) return;

	showReadyPulse.value = true;
	if (readyPulseTimer) clearTimeout(readyPulseTimer);
	readyPulseTimer = setTimeout(() => {
		showReadyPulse.value = false;
		readyPulseTimer = null;
	}, 700);
});

const iconKind = computed((): "migrate" | "pending" | "measure" | null => {
	if (props.loading) return null;
	if (props.label === "Almost there") return "pending";
	if (props.label.includes("Measuring")) return "measure";
	return "migrate";
});

const TILT_LERP = 0.16;
const TILT_RETURN_LERP = 0.11;
const ICON_LAG = 0.38;

const targetX = ref(0);
const targetY = ref(0);
const currentX = ref(0);
const currentY = ref(0);
const iconX = ref(0);
const iconY = ref(0);
let tracking = false;
let rafId: number | null = null;

const ctaTiltStyle = computed(() => ({
	"--dock-tilt-x": currentX.value.toFixed(4),
	"--dock-tilt-y": currentY.value.toFixed(4),
	"--dock-icon-tilt-x": iconX.value.toFixed(4),
	"--dock-icon-tilt-y": iconY.value.toFixed(4),
}));

function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clampTilt(v: number) {
	const c = Math.max(-1, Math.min(1, v));
	return Math.sign(c) * Math.pow(Math.abs(c), 0.82);
}

function tickTilt() {
	const goalX = tracking ? targetX.value : 0;
	const goalY = tracking ? targetY.value : 0;
	const lerp = tracking ? TILT_LERP : TILT_RETURN_LERP;

	currentX.value += (goalX - currentX.value) * lerp;
	currentY.value += (goalY - currentY.value) * lerp;
	iconX.value += (currentX.value - iconX.value) * ICON_LAG;
	iconY.value += (currentY.value - iconY.value) * ICON_LAG;

	const settled =
		!tracking &&
		Math.abs(currentX.value) < 0.002 &&
		Math.abs(currentY.value) < 0.002 &&
		Math.abs(iconX.value) < 0.002 &&
		Math.abs(iconY.value) < 0.002;

	if (settled) {
		currentX.value = 0;
		currentY.value = 0;
		iconX.value = 0;
		iconY.value = 0;
		rafId = null;
		return;
	}

	rafId = requestAnimationFrame(tickTilt);
}

function startTiltLoop() {
	if (rafId === null) rafId = requestAnimationFrame(tickTilt);
}

function onCtaPointerMove(e: MouseEvent) {
	if (props.disabled || props.loading || prefersReducedMotion()) return;

	const el = e.currentTarget as HTMLElement;
	const rect = el.getBoundingClientRect();
	const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
	const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

	tracking = true;
	targetX.value = clampTilt(nx);
	targetY.value = clampTilt(ny * 0.45);
	startTiltLoop();
}

function onCtaPointerLeave() {
	tracking = false;
	targetX.value = 0;
	targetY.value = 0;
	startTiltLoop();
}

onUnmounted(() => {
	if (rafId !== null) cancelAnimationFrame(rafId);
	if (readyPulseTimer) clearTimeout(readyPulseTimer);
});
</script>

<template>
	<footer
		class="app-dock"
		:class="{ 'dock-ready': isReady, 'dock-ready-pulse': showReadyPulse }"
	>
		<div class="dock-shell">
			<div v-if="$slots.top" class="app-dock-top">
				<slot name="top" />
			</div>

			<div class="dock-row">
				<slot name="leading" />

				<AppButton
					block
					class="dock-cta"
					variant="primary"
					:disabled="disabled"
					:loading="loading"
					:style="ctaTiltStyle"
					@mousemove="onCtaPointerMove"
					@mouseleave="onCtaPointerLeave"
					@click="$emit('action')"
				>
					<span class="dock-cta-inner">
						<span class="dock-label">{{ label }}</span>
						<DockIcon v-if="iconKind" :kind="iconKind" />
					</span>
				</AppButton>
			</div>
		</div>
	</footer>
</template>

<style scoped>
.app-dock {
	--dock-h: var(--app-dock-h, 3rem);
	--dock-h-grow: var(--app-dock-h-grow, 0.5rem);
	--dock-h-active: calc(var(--dock-h) + var(--dock-h-grow));
	--dock-lift: var(--app-dock-lift, 0.85rem);
	--dock-ease: cubic-bezier(0.22, 1, 0.36, 1);
	--dock-ease-bounce: cubic-bezier(0.22, 1.9, 0.36, 1);
	position: fixed;
	left: var(--site-padding-x, 1.25rem);
	right: var(--site-padding-x, 1.25rem);
	bottom: 0;
	z-index: 30;
	pointer-events: none;
}

.dock-shell {
	pointer-events: auto;
	background: #0a0a0a;
	color: #fff;
	border-radius: 14px 14px 0 0;
	overflow: hidden;
	box-shadow: none;
	transform: translateY(0);
	transition:
		transform 0.38s var(--dock-ease),
		border-radius 0.42s var(--dock-ease),
		box-shadow 0.36s ease;
}

.app-dock.dock-ready:hover .dock-shell,
.app-dock.dock-ready:focus-within .dock-shell {
	border-radius: var(--radius-pill, 999px);
	box-shadow: 0 10px 32px rgba(0, 0, 0, 0.2);
	/* Transform only — padding would leave a dead zone and flicker at the bottom edge */
	transform: translateY(calc(-1 * var(--dock-lift)));
}

.app-dock:not(.dock-ready) .dock-shell {
	transition:
		transform 0.38s var(--dock-ease),
		border-radius 0.42s var(--dock-ease),
		box-shadow 0.36s ease,
		background-color 0.35s ease;
}

.app-dock-top {
	position: relative;
}

.app-dock-top :deep(.dock-error) {
	position: absolute;
	bottom: 100%;
	left: 0;
	right: 0;
	margin: 0;
	padding: 0.35rem 0.75rem;
	font-size: 0.68rem;
	text-align: center;
	color: #fca5a5;
	background: #0a0a0a;
	border-radius: var(--radius-pill, 999px);
}

.app-dock-top :deep(.dock-warning) {
	position: absolute;
	bottom: 100%;
	left: 0;
	right: 0;
	margin: 0;
	padding: 0.35rem 0.75rem;
	font-size: 0.68rem;
	line-height: 1.35;
	text-align: center;
	color: #fde68a;
	background: #0a0a0a;
	border-radius: var(--radius-pill, 999px);
}

.app-dock-top :deep(.dock-folders) {
	position: absolute;
	bottom: 100%;
	left: 0;
	right: 0;
	margin: 0;
	padding: 0.45rem 0.75rem;
	list-style: none;
	max-height: 5.5rem;
	overflow-y: auto;
	background: #0a0a0a;
	border: 1px solid rgba(255, 255, 255, 0.1);
	border-radius: var(--radius-pill, 999px);
	font-size: 0.68rem;
	scrollbar-width: thin;
}

.app-dock-top :deep(.dock-folders li label) {
	display: flex;
	gap: 0.4rem;
	cursor: pointer;
	padding: 0.1rem 0;
	color: rgba(255, 255, 255, 0.88);
}

.dock-row {
	display: flex;
	align-items: stretch;
	height: var(--dock-h);
	transition: height 0.62s var(--dock-ease-bounce);
}

.app-dock.dock-ready:hover .dock-row,
.app-dock.dock-ready:focus-within .dock-row {
	height: var(--dock-h-active);
}

.app-dock :deep(.dock-folders-toggle),
.app-dock :deep(.dock-back) {
	flex-shrink: 0;
	align-self: stretch;
	display: inline-flex;
	align-items: center;
	gap: 0.4rem;
	padding: 0 0.85rem;
	border: none;
	border-right: 1px solid rgba(255, 255, 255, 0.12);
	background: transparent;
	color: rgba(255, 255, 255, 0.7);
	font-size: 0.72rem;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
}

.app-dock :deep(.dock-folders-toggle:hover),
.app-dock :deep(.dock-back:hover) {
	color: #fff;
}

.app-dock :deep(.dock-folder-icon) {
	width: 1rem;
	height: 1rem;
	flex-shrink: 0;
	transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.app-dock.dock-ready:hover :deep(.dock-folder-icon),
.app-dock.dock-ready:focus-within :deep(.dock-folder-icon) {
	transform: translateY(-2px);
}

.app-dock :deep(.dock-cta.btn) {
	flex: 1;
	width: auto;
	max-width: none;
	min-width: 0;
	height: 100%;
	margin: 0;
	padding: 0 1rem;
	border-radius: 0;
	font-size: 0.9375rem;
	font-weight: 700;
	letter-spacing: -0.02em;
	background: transparent;
	color: #fff;
	opacity: 1;
	transition:
		font-size 0.62s var(--dock-ease-bounce),
		color 0.15s ease,
		opacity 0.15s ease;
}

.app-dock.dock-ready:hover :deep(.dock-cta.btn:not(:disabled)),
.app-dock.dock-ready:focus-within :deep(.dock-cta.btn:not(:disabled)) {
	font-size: 1.0625rem;
}

.app-dock :deep(.dock-cta.btn:disabled) {
	cursor: not-allowed;
	color: rgba(255, 255, 255, 0.72);
}

.app-dock :deep(.dock-cta.btn:disabled) .dock-icon-wrap {
	opacity: 0.72;
}

.app-dock:not(.dock-ready) .dock-shell {
	background: #2a2a2a;
}

.app-dock.dock-ready-pulse .dock-shell {
	animation: dock-ready-pulse 0.7s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes dock-ready-pulse {
	0% {
		background-color: #2a2a2a;
		box-shadow: none;
	}
	35% {
		background-color: #141414;
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.2),
			0 8px 28px rgba(255, 255, 255, 0.08);
	}
	100% {
		background-color: #0a0a0a;
		box-shadow: none;
	}
}

.app-dock :deep(.dock-cta.btn:not(:disabled)) {
	perspective: 900px;
}

.app-dock :deep(.dock-cta-inner) {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	will-change: transform;
	transform: translate3d(
			calc(var(--dock-tilt-x, 0) * 14px),
			calc(var(--dock-tilt-y, 0) * 4px),
			0
		)
		rotateY(calc(var(--dock-tilt-x, 0) * -6deg));
	transform-style: preserve-3d;
}

.app-dock :deep(.dock-label) {
	line-height: 1.2;
	transition: color 0.2s ease;
}

.app-dock :deep(.dock-icon-wrap) {
	width: 1.125rem;
	height: 1.125rem;
	opacity: 0.75;
	will-change: transform;
	transform: translate3d(
		calc(var(--dock-icon-tilt-x, 0) * 7px),
		calc(var(--dock-icon-tilt-y, 0) * 3px),
		0
	);
	transition:
		width 0.38s var(--dock-ease),
		height 0.38s var(--dock-ease),
		opacity 0.28s ease;
}

.app-dock.dock-ready:hover :deep(.dock-icon-wrap),
.app-dock.dock-ready:focus-within :deep(.dock-icon-wrap) {
	width: 1.3125rem;
	height: 1.3125rem;
	opacity: 1;
}

.app-dock :deep(.dock-cta .spin) {
	border-color: rgba(255, 255, 255, 0.25);
	border-top-color: rgba(255, 255, 255, 0.45);
}

@media (prefers-reduced-motion: reduce) {
	.app-dock,
	.dock-shell,
	.dock-row,
	.app-dock.dock-ready:hover .dock-shell,
	.app-dock.dock-ready:focus-within .dock-shell,
	.app-dock :deep(.dock-cta.btn),
	.app-dock :deep(.dock-cta-inner),
	.app-dock :deep(.dock-icon-wrap),
	.app-dock :deep(.dock-folder-icon) {
		transition: none;
	}

	.app-dock.dock-ready-pulse .dock-shell {
		animation: none;
		background-color: #0a0a0a;
	}

	.app-dock.dock-ready:hover .dock-row,
	.app-dock.dock-ready:focus-within .dock-row {
		height: var(--dock-h-active);
	}

	.app-dock.dock-ready:hover .dock-shell,
	.app-dock.dock-ready:focus-within .dock-shell {
		border-radius: var(--radius-pill, 999px);
		box-shadow: 0 10px 36px rgba(0, 0, 0, 0.22);
		transform: translateY(calc(-1 * var(--dock-lift)));
	}

	.app-dock.dock-ready:hover :deep(.dock-cta.btn:not(:disabled)),
	.app-dock.dock-ready:focus-within :deep(.dock-cta.btn:not(:disabled)) {
		font-size: 1.0625rem;
	}

	.app-dock.dock-ready:hover :deep(.dock-icon-wrap),
	.app-dock.dock-ready:focus-within :deep(.dock-icon-wrap) {
		width: 1.3125rem;
		height: 1.3125rem;
	}

	.app-dock.dock-ready:hover :deep(.dock-folder-icon),
	.app-dock.dock-ready:focus-within :deep(.dock-folder-icon),
	.app-dock :deep(.dock-cta-inner),
	.app-dock :deep(.dock-icon-wrap) {
		transform: none;
	}
}
</style>
