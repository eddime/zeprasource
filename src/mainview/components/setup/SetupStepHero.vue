<script setup lang="ts">
import ZebraMascot from "../zebra/ZebraMascot.vue";
import AppButton from "../ui/AppButton.vue";

withDefaults(
	defineProps<{
		eyebrow: string;
		title: string;
		subline: string;
		showBack?: boolean;
	}>(),
	{ showBack: false },
);

defineEmits<{ back: [] }>();
</script>

<template>
	<header class="setup-hero">
		<div class="setup-hero-zebra">
			<div class="zebra-mask">
				<div class="zebra-riser">
					<ZebraMascot state="idle" :size="140" class="hero-zebra-img" />
				</div>
			</div>
		</div>
		<div class="setup-hero-copy">
			<div class="setup-hero-head">
				<div class="setup-hero-head-text">
					<p class="eyebrow">{{ eyebrow }}</p>
					<h1 class="hero-title">{{ title }}</h1>
				</div>
				<AppButton
					v-if="showBack"
					variant="secondary"
					size="sm"
					class="hero-back-btn"
					@click="$emit('back')"
				>
					<span class="hero-back-icon" aria-hidden="true">←</span>
					Back
				</AppButton>
			</div>
			<p class="hero-sub">{{ subline }}</p>
		</div>
	</header>
</template>

<style scoped>
.setup-hero {
	flex-shrink: 0;
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.5rem 1.25rem;
	align-items: center;
	padding: 0.7rem 1.15rem;
	min-height: 0;
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

.setup-hero-zebra {
	flex-shrink: 0;
	overflow: visible;
	display: flex;
	align-items: center;
	justify-content: center;
}

.zebra-mask {
	position: relative;
	flex-shrink: 0;
	width: 9rem;
	height: 7rem;
	min-height: 7rem;
	max-height: 7rem;
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

.setup-hero-copy {
	min-width: 0;
	display: flex;
	flex-direction: column;
	justify-content: center;
}

.setup-hero-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

.setup-hero-head-text {
	min-width: 0;
}

.hero-back-btn {
	flex-shrink: 0;
}

.hero-back-btn :deep(.btn) {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	border: 1.5px solid var(--border);
	border-radius: var(--radius-pill);
	font-weight: 700;
}

.hero-back-icon {
	font-size: 0.9rem;
	line-height: 1;
	opacity: 0.75;
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
	margin: 0.2rem 0 0;
	font-size: 1.5rem;
	font-weight: 800;
	letter-spacing: -0.035em;
	line-height: 1.05;
	color: var(--fg);
}

.hero-sub {
	margin: 0.3rem 0 0;
	font-size: 0.88rem;
	line-height: 1.4;
	color: var(--muted);
	max-width: 34rem;
}
</style>
