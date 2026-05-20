<script setup lang="ts">
import { computed } from "vue";
import singleMail from "@/assets/single-mail.png";

const props = defineProps<{
	paused?: boolean;
}>();

type MailParticle = {
	id: number;
	size: number;
	duration: number;
	delay: number;
	opacity: number;
	top: number;
	spinTurns: number;
};

/** Stable-ish variety without re-randomizing on re-render. */
function mulberry32(seed: number) {
	return () => {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function buildParticles(count: number): MailParticle[] {
	const rand = mulberry32(0x7a3b_91c4);
	return Array.from({ length: count }, (_, id) => {
		const duration = 7 + rand() * 16;
		return {
			id,
			size: 12 + rand() * 36,
			duration,
			delay: -rand() * duration,
			opacity: 0.4 + rand() * 0.6,
			top: 4 + rand() * 92,
			spinTurns: 1 + Math.floor(rand() * 3),
		};
	});
}

const particles = computed(() => buildParticles(16));

function particleStyle(p: MailParticle): Record<string, string> {
	return {
		"--mail-size": `${p.size}px`,
		"--mail-duration": `${p.duration}s`,
		"--mail-delay": `${p.delay}s`,
		"--mail-opacity": String(p.opacity),
		"--mail-top": `${p.top}%`,
		"--mail-rotate-end": `${p.spinTurns * 360}deg`,
	};
}
</script>

<template>
	<div class="mail-particles" :class="{ 'mail-particles--paused': paused }" aria-hidden="true">
		<img
			v-for="p in particles"
			:key="p.id"
			class="mail-particle"
			:src="singleMail"
			alt=""
			draggable="false"
			:style="particleStyle(p)"
		/>
	</div>
</template>

<style scoped>
.mail-particles {
	position: absolute;
	inset: 0;
	z-index: 2;
	overflow: hidden;
	pointer-events: none;
}

.mail-particle {
	position: absolute;
	right: -4%;
	top: var(--mail-top);
	width: var(--mail-size);
	height: auto;
	opacity: var(--mail-opacity);
	will-change: transform;
	animation: mail-drift var(--mail-duration) linear infinite var(--mail-delay);
}

.mail-particles--paused .mail-particle {
	animation-play-state: paused;
}

@keyframes mail-drift {
	0% {
		transform: translateX(14vw) rotate(0deg);
	}
	100% {
		transform: translateX(calc(-112vw - var(--mail-size))) rotate(var(--mail-rotate-end));
	}
}

@media (prefers-reduced-motion: reduce) {
	.mail-particles {
		display: none;
	}
}
</style>
