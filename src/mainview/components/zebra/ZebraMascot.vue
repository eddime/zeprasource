<script setup lang="ts">
import { computed } from "vue";
import zepraConnect from "@/assets/zebra/zepra-connect.png";
import zepraDetective from "@/assets/zebra/zepra-detective.png";
import zepraRun from "@/assets/zebra/zepra-run.png";
import zepraSleep from "@/assets/zebra/zepra-sleep.png";
import zepraSnapshot from "@/assets/zebra/zepra-snapshot.png";

export type ZebraState = "idle" | "running" | "paused" | "success" | "failed";

const props = withDefaults(
	defineProps<{
		state?: ZebraState;
		size?: number;
		/** Welcome / calm screen — sleeping zebra instead of connect peek */
		mood?: "default" | "sleep";
	}>(),
	{ state: "idle", size: 160, mood: "default" },
);

const isConnect = computed(
	() => props.state === "idle" && props.mood !== "sleep",
);

const displaySize = computed(() =>
	isConnect.value ? Math.round(props.size * 1.2) : props.size,
);

const STATE_IMAGES: Record<ZebraState, string> = {
	idle: zepraConnect,
	running: zepraRun,
	paused: zepraRun,
	success: zepraSnapshot,
	failed: zepraDetective,
};

const altText: Record<ZebraState, string> = {
	idle: "Zepra zebra ready to connect",
	running: "Zepra zebra migrating mail",
	paused: "Zepra zebra paused",
	success: "Zepra zebra celebrating",
	failed: "Zepra zebra investigating a problem",
};

const imageSrc = computed(() => {
	if (props.mood === "sleep" && props.state === "idle") {
		return zepraSleep;
	}
	return STATE_IMAGES[props.state];
});

const imageAlt = computed(() => {
	if (props.mood === "sleep" && props.state === "idle") {
		return "Zepra zebra resting";
	}
	return altText[props.state];
});
</script>

<template>
	<div
		class="zebra-wrap"
		:class="[
			`state-${state}`,
			mood === 'sleep' ? 'mood-sleep' : '',
			isConnect ? 'variant-connect' : '',
		]"
		:style="{
			width: `${displaySize}px`,
			height: `${displaySize}px`,
		}"
	>
		<img
			:src="imageSrc"
			:alt="imageAlt"
			class="zebra-img"
			:class="{
				trot: state === 'running',
				bounce: state === 'success',
			}"
			draggable="false"
		/>
	</div>
</template>

<style scoped>
.zebra-wrap {
	display: grid;
	place-items: center;
	margin: 0 auto;
	overflow: visible;
}

.zebra-img {
	width: 100%;
	height: 100%;
	object-fit: contain;
	object-position: center;
	display: block;
	user-select: none;
	pointer-events: none;
}

.variant-connect .zebra-img {
	width: 118%;
	height: 118%;
	object-position: center 88%;
}

.state-running .trot {
	animation: trot 0.55s ease-in-out infinite;
}

.state-success .bounce {
	animation: bounce 1.2s ease-in-out infinite;
}

.mood-sleep .zebra-img {
	animation: breathe 2.4s ease-in-out infinite;
}

@keyframes trot {
	0%,
	100% {
		transform: translateY(0) rotate(-1deg);
	}
	50% {
		transform: translateY(-6px) rotate(1deg);
	}
}

@keyframes bounce {
	0%,
	100% {
		transform: translateY(0);
	}
	50% {
		transform: translateY(-10px);
	}
}

@keyframes breathe {
	0%,
	100% {
		transform: translateY(0);
	}
	50% {
		transform: translateY(-4px);
	}
}

@media (prefers-reduced-motion: reduce) {
	.trot,
	.bounce,
	.mood-sleep .zebra-img {
		animation: none;
	}
}
</style>
