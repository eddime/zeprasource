<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import zepraRoomBg from "@/assets/zepra-room-bg.png";
import ZebraMascot from "../zebra/ZebraMascot.vue";
import AppDock from "../ui/AppDock.vue";
import PricingSheet from "../pricing/PricingSheet.vue";
import SessionRail from "../sessions/SessionRail.vue";
import PerkIcon, { type PerkIconKind } from "./PerkIcon.vue";
import { useMigrationStore } from "../../stores/migration";

const emit = defineEmits<{
	start: [];
	"select-session": [id: string];
	"test-payment": [];
}>();

const isDev = import.meta.env.DEV;

const migration = useMigrationStore();
const { activeSessions, pastSessions, hasSessionCards, sessionsHydrated } =
	storeToRefs(migration);

const pricingOpen = ref(false);
const selectedSessionId = ref<string | null>(null);

const showSessionRails = computed(
	() => sessionsHydrated.value && hasSessionCards.value,
);

function onSelectSession(id: string) {
	selectedSessionId.value = id;
	emit("select-session", id);
}

const perks: Array<{ icon: PerkIconKind; title: string; text: string }> = [
	{ icon: "mac", title: "On your device", text: "Mail stays local." },
	{ icon: "direct", title: "No cloud relay", text: "IMAP to IMAP." },
	{ icon: "resume", title: "Resume anytime", text: "Continue later." },
	{ icon: "folders", title: "Folders & flags", text: "Structure kept." },
];
</script>

<template>
	<div class="welcome" :class="{ 'welcome--has-sessions': showSessionRails }">
		<header class="welcome-top">
			<button
				v-if="isDev"
				type="button"
				class="pricing-link test-payment-link"
				@click="emit('test-payment')"
			>
				Test payment
			</button>
			<button type="button" class="pricing-link" @click="pricingOpen = true">Pricing</button>
		</header>
		<PricingSheet v-model:open="pricingOpen" />

		<template v-if="showSessionRails">
			<SessionRail
				v-if="activeSessions.length > 0"
				side="left"
				:sessions="activeSessions"
				:selected-id="selectedSessionId"
				@select="onSelectSession"
			/>
			<SessionRail
				v-if="pastSessions.length > 0"
				side="right"
				:sessions="pastSessions"
				:selected-id="selectedSessionId"
				@select="onSelectSession"
			/>
		</template>

		<div class="welcome-scene" aria-hidden="true">
			<div
				class="welcome-bg"
				:style="{ backgroundImage: `url(${zepraRoomBg})` }"
			/>
			<div class="welcome-vignette" />
		</div>

		<div class="welcome-scroll">
			<div class="mascot-shell anim" style="--i: 0">
				<ZebraMascot state="idle" mood="sleep" :size="200" />
			</div>

			<div class="copy">
				<h1 class="title anim" style="--i: 1">Zepra</h1>
				<p class="sub anim" style="--i: 2">
					Move your mailbox locally - safe, private first, simple, offline-ready.
				</p>

				<ul class="perks anim" style="--i: 3">
					<li v-for="p in perks" :key="p.title">
						<span class="perk-icon" aria-hidden="true">
							<PerkIcon :kind="p.icon" />
						</span>
						<strong>{{ p.title }}</strong>
						<span>{{ p.text }}</span>
					</li>
				</ul>
			</div>
		</div>

		<AppDock label="Start migration" @action="$emit('start')" />
	</div>
</template>

<style scoped>
.welcome-top {
	position: absolute;
	top: 0;
	right: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	gap: 0.15rem;
	padding: 1rem var(--site-padding-x, 1.25rem);
	pointer-events: none;
}

.test-payment-link {
	color: color-mix(in srgb, #b45309 75%, var(--muted));
	font-weight: 600;
}

.test-payment-link:hover {
	color: #b45309;
	background: color-mix(in srgb, #b45309 8%, transparent);
}

.pricing-link {
	pointer-events: auto;
	border: none;
	background: transparent;
	font-family: var(--font-sans);
	font-size: 0.8125rem;
	font-weight: 500;
	color: var(--muted);
	cursor: pointer;
	padding: 0.35rem 0.5rem;
	border-radius: 8px;
	transition: color 0.15s ease, background 0.15s ease;
}

.pricing-link:hover {
	color: var(--fg);
	background: rgba(255, 255, 255, 0.55);
}

.welcome {
	--welcome-lift: 3.5rem;
	position: relative;
	height: 100%;
	width: 100%;
	align-self: stretch;
	display: flex;
	flex-direction: column;
	min-height: 0;
	overflow: hidden;
}

.welcome-scene {
	position: absolute;
	top: calc(-1 * var(--welcome-lift));
	left: 0;
	right: 0;
	bottom: 0;
	z-index: 0;
	overflow: hidden;
	pointer-events: none;
}

.welcome-bg {
	position: absolute;
	top: 0;
	bottom: 0;
	left: -14%;
	right: -14%;
	width: auto;
	background-repeat: no-repeat;
	background-size: cover;
	background-position: center top;
	transform: scale(1.22) translateY(-21%);
	transform-origin: 50% 0%;
}

.welcome-vignette {
	position: absolute;
	inset: 0;
	z-index: 1;
	pointer-events: none;
	background: #fff;
	-webkit-mask-image: radial-gradient(
		ellipse 99% 95% at 50% 40%,
		transparent 0%,
		transparent 10%,
		rgba(0, 0, 0, 0.5) 26%,
		#000 40%,
		#000 100%
	);
	mask-image: radial-gradient(
		ellipse 99% 95% at 50% 40%,
		transparent 0%,
		transparent 10%,
		rgba(0, 0, 0, 0.5) 26%,
		#000 40%,
		#000 100%
	);
}

.welcome-scroll {
	position: relative;
	z-index: 1;
	flex: 1;
	min-height: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: flex-start;
	text-align: center;
	padding: 0rem var(--site-padding-x) var(--app-dock-h-hover);
	box-sizing: border-box;
	transform: translateY(-24px);
	overscroll-behavior: none;
}

.mascot-shell {
	margin-top: clamp(5.5rem, 22vh, 9.25rem);
	margin-bottom: 0;
	flex-shrink: 0;
}

.welcome--has-sessions .copy {
	max-width: min(var(--welcome-center-max), calc(100% - 27rem));
}

.copy {
	--welcome-center-max: 26.5rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	width: 100%;
	max-width: var(--welcome-center-max);
	margin-top: 2rem;
	flex-shrink: 0;
	padding-inline: 0.25rem;
	box-sizing: border-box;
}

.title {
	margin: 0;
	font-size: clamp(3.35rem, 7vw, 4.5rem);
	font-weight: 800;
	letter-spacing: -0.04em;
	line-height: 1;
}

.sub {
	margin: 0.65rem auto 0;
	font-family: var(--font-display);
	font-size: clamp(0.8125rem, 1.45vw, 1rem);
	font-weight: 400;
	line-height: 1.4;
	letter-spacing: -0.015em;
	color: #525252;
	max-width: var(--welcome-center-max);
	white-space: normal;
}

.perks {
	list-style: none;
	margin: 1.1rem auto 0;
	padding: 0;
	display: flex;
	flex-direction: row;
	align-items: flex-start;
	justify-content: center;
	gap: 0.35rem 0.4rem;
	width: 100%;
	max-width: 24.5rem;
}

.perks li {
	flex: 1 1 0;
	min-width: 0;
	max-width: 5.65rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.2rem;
	text-align: center;
}

.perk-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: #000;
	flex-shrink: 0;
	margin-bottom: 0.05rem;
}

.perk-icon :deep(.perk-icon-svg) {
	width: 1.2rem;
	height: 1.2rem;
}

.perks strong {
	font-size: 0.625rem;
	font-weight: 700;
	line-height: 1.2;
	letter-spacing: -0.01em;
}

.perks span {
	font-size: 0.5625rem;
	color: var(--muted-light);
	line-height: 1.28;
}

@media (max-width: 720px) {
	.perks {
		flex-wrap: wrap;
		max-width: 22rem;
	}

	.perks li {
		flex: 1 1 calc(50% - 0.625rem);
	}
}

.anim {
	opacity: 0;
	animation: pop 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
	animation-delay: calc(var(--i) * 0.07s);
}

@keyframes pop {
	from {
		opacity: 0;
		transform: translateY(12px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@media (prefers-reduced-motion: reduce) {
	.anim {
		animation: none;
		opacity: 1;
	}
}
</style>
