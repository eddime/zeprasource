<script setup lang="ts">
import { computed, ref, watch } from "vue";
import stripeWordmark from "@/assets/stripe-wordmark.svg";
import { BACKUP_COPY } from "../../../shared/backup-copy";
import { paymentErrorMessage } from "../../../shared/user-messages";
import { formatMoney } from "../../../shared/pricing";
import { usePricingStore } from "../../stores/pricing";

const open = defineModel<boolean>("open", { default: false });
const pricing = usePricingStore();
const lifetimeError = ref<string | null>(null);

watch(open, (isOpen) => {
	if (!isOpen) return;
	lifetimeError.value = null;
	void pricing.ensureLoaded(true);
	void pricing.refreshEntitlement(true);
});

async function buyLifetime() {
	lifetimeError.value = null;
	try {
		await pricing.purchaseLifetime();
	} catch (err) {
		lifetimeError.value = paymentErrorMessage(err);
	}
}

const lifetimePrice = computed(() => pricing.lifetimeCatalog.priceLabel);

const showPricingHero = computed(
	() => pricing.isReady || pricing.lifetimeReady || pricing.hasLifetime,
);

const showLifetimeBelow = computed(
	() => pricing.hasLifetime || pricing.lifetimeReady,
);

const freeLimitGb = computed(() => pricing.activeCatalog?.freeLimitGb);

const unitPrice = computed(() => {
	const c = pricing.activeCatalog;
	if (!c) return "—";
	return formatMoney(c.pricePerGbCents, c.currency);
});

function close() {
	open.value = false;
}
</script>

<template>
	<svg class="sheet-clip-svg" aria-hidden="true" focusable="false">
		<defs>
			<clipPath id="pricing-zebra-clip" clipPathUnits="objectBoundingBox">
				<path
					d="
						M 0.22,0
						L 1,0 L 1,1 L 0.22,1
						C 0.22,0.93 0.17,0.87 0.18,0.8
						C 0.19,0.73 0.21,0.68 0.22,0.62
						C 0.22,0.55 0.16,0.49 0.18,0.42
						C 0.19,0.35 0.21,0.3 0.22,0.24
						C 0.22,0.17 0.16,0.11 0.18,0.05
						C 0.19,0.02 0.21,0.01 0.22,0 Z
					"
				/>
			</clipPath>
		</defs>
	</svg>
	<Teleport to="body">
		<Transition name="scrim">
			<button
				v-if="open"
				type="button"
				class="sheet-scrim"
				aria-label="Close fair pricing"
				@click="close"
			/>
		</Transition>
		<Transition name="sheet">
			<aside
				v-if="open"
				class="sheet sheet-side"
				role="dialog"
				aria-labelledby="pricing-title"
				@click.stop
			>
				<svg
					class="sheet-wave-border"
					viewBox="0 0 1 1"
					preserveAspectRatio="none"
					aria-hidden="true"
					focusable="false"
				>
					<path
						class="sheet-wave-border-path"
						pathLength="1"
						d="
							M 0.16,0.988
							L 0.22,0.988
							C 0.22,0.92 0.17,0.862 0.18,0.793
							C 0.19,0.725 0.21,0.676 0.22,0.617
							C 0.22,0.549 0.16,0.49 0.18,0.422
							C 0.19,0.354 0.21,0.305 0.22,0.246
							C 0.22,0.178 0.16,0.119 0.18,0.061
							C 0.19,0.032 0.21,0.022 0.22,0.012
							L 0.16,0.012
						"
						fill="none"
						stroke="#000"
						stroke-width="12"
						stroke-linecap="round"
						stroke-linejoin="round"
						vector-effect="non-scaling-stroke"
					/>
				</svg>

				<button type="button" class="x" aria-label="Close" @click="close">×</button>

				<div class="sheet-inner">
					<div class="sheet-body">
					<div class="sheet-main">
						<header class="sheet-head">
							<h2 id="pricing-title">Fair pricing</h2>
							<p class="sheet-prose">
								Let's be fair: who wants a subscription just to move email?
								<strong v-if="pricing.isReady">{{ freeLimitGb }} GB free</strong>
								<strong v-else>A free tier</strong>
								per migration, enough for most.
								Need more?
								<strong v-if="pricing.isReady">{{ pricing.activeCatalog!.pricePerGbLabel }}</strong>
								<strong v-else>fair per-gigabyte pricing</strong>, pay once.
								<template v-if="showLifetimeBelow && !pricing.hasLifetime">
									Or own Zepra for
									<strong>{{ lifetimePrice }}</strong>
									forever & unlimited.
								</template>
								<template v-else-if="pricing.hasLifetime">
									Your Lifetime license covers every run.
								</template>
								Clear pricing, no hidden costs. {{ BACKUP_COPY.pricingLead }}
							</p>
						</header>

						<section
							v-if="showPricingHero"
							class="pricing-hero"
							aria-label="How pricing works"
						>
							<div v-if="pricing.isReady" class="hero-rules">
								<article class="rule rule--free">
									<p class="rule-kicker">Per migration</p>
									<p class="rule-value">
										<span class="rule-num">{{ freeLimitGb }}</span>
										<span class="rule-unit">GB</span>
									</p>
									<p class="rule-label">free</p>
								</article>

								<div class="rule-divider" aria-hidden="true" />

								<article class="rule rule--paid">
									<p class="rule-kicker">Above {{ freeLimitGb }} GB</p>
									<p class="rule-value">
										<span class="rule-num">{{ unitPrice }}</span>
									</p>
									<p class="rule-label">/ GB · per migration</p>
								</article>
							</div>

							<p
								v-if="pricing.isReady && showLifetimeBelow"
								class="pricing-or"
								aria-hidden="true"
							>
								or
							</p>

							<div
								v-if="showLifetimeBelow"
								class="lifetime-below"
								:class="{ 'lifetime-below--active': pricing.hasLifetime }"
								:role="pricing.hasLifetime ? 'status' : undefined"
								aria-label="Zepra Lifetime"
							>
								<div class="lifetime-below-main">
									<p class="lifetime-below-kicker">Own Zepra forever</p>
									<template v-if="pricing.hasLifetime">
										<p class="lifetime-below-title">
											<span class="lifetime-below-check" aria-hidden="true">✓</span>
											Lifetime active
										</p>
										<p class="lifetime-below-meta">Unlimited migrations</p>
									</template>
									<template v-else>
										<p class="lifetime-below-price">{{ lifetimePrice }}</p>
										<p class="lifetime-below-meta">
											Unlimited runs · Mac, Windows, and Linux
										</p>
									</template>
								</div>
								<button
									v-if="!pricing.hasLifetime && pricing.lifetimeCheckoutReady"
									type="button"
									class="lifetime-below-cta"
									:disabled="pricing.lifetimeLoading"
									@click="buyLifetime"
								>
									{{
										pricing.lifetimeLoading
											? "Waiting…"
											: "Get Lifetime"
									}}
								</button>
							</div>
							<p
								v-if="lifetimeError && showLifetimeBelow && !pricing.hasLifetime"
								class="lifetime-below-error"
								role="alert"
							>
								{{ lifetimeError }}
							</p>
						</section>

					</div>

					<footer class="sheet-foot">
						<div class="stripe-trust">
							<img
								class="stripe-logo"
								:src="stripeWordmark"
								width="52"
								height="22"
								alt="Stripe"
								decoding="async"
							/>
							<p class="stripe-copy">
								Payments are processed securely by Stripe.
							</p>
						</div>
						<p class="note">
							Part of every paid migration supports
							<a
								href="https://www.marwell.org.uk/save-our-stripes/"
								target="_blank"
								rel="noopener noreferrer"
							>Save Our Stripes</a>
							at Marwell Wildlife.
						</p>
					</footer>
					</div>
				</div>
			</aside>
		</Transition>
	</Teleport>
</template>

<style scoped>
.sheet-clip-svg {
	position: absolute;
	width: 0;
	height: 0;
	overflow: hidden;
}

.sheet-scrim {
	position: fixed;
	inset: 0;
	z-index: 40;
	margin: 0;
	padding: 0;
	border: none;
	background: rgba(10, 10, 10, 0.14);
	cursor: default;
}

.scrim-enter-active {
	transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.scrim-leave-active {
	transition: opacity 0.28s ease;
}

.scrim-enter-from,
.scrim-leave-to {
	opacity: 0;
}

.sheet {
	position: fixed;
	bottom: 0;
	left: 50%;
	transform: translateX(-50%);
	width: min(400px, 100%);
	height: min(100%, var(--zepra-window-h, 640px));
	max-height: var(--zepra-window-h, 640px);
	overflow: hidden;
	background: var(--surface);
	border-radius: var(--radius-card) var(--radius-card) 0 0;
	padding: 0;
	z-index: 50;
	box-shadow: 0 -24px 80px rgba(0, 0, 0, 0.1);
	box-sizing: border-box;
}

.sheet-inner {
	--sheet-pad-block: 2rem;
	--sheet-pad-inline: 1.35rem;
	height: 100%;
	display: flex;
	flex-direction: column;
	justify-content: center;
	padding: var(--sheet-pad-block) var(--sheet-pad-inline);
	box-sizing: border-box;
	min-height: 0;
	overflow-y: auto;
	scrollbar-width: thin;
	background: linear-gradient(
		165deg,
		#fff 0%,
		#fafafa 42%,
		#f5f5f5 100%
	);
}

.sheet-body {
	width: 100%;
	margin-block: auto;
	display: flex;
	flex-direction: column;
	gap: 1.15rem;
}

.sheet-main {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.x {
	position: absolute;
	top: 0.9rem;
	right: 0.9rem;
	width: 2rem;
	height: 2rem;
	border: none;
	background: var(--btn-secondary);
	border-radius: var(--radius-pill);
	font-size: 1.15rem;
	cursor: pointer;
	color: var(--muted);
	line-height: 1;
	z-index: 1;
	transition: background 0.15s ease, color 0.15s ease;
}

.x:hover {
	background: #e8e8e8;
	color: var(--fg);
}

.sheet-head {
	padding-right: 2.35rem;
	flex-shrink: 0;
}

h2 {
	margin: 0 0 0.65rem;
	font-size: 1.55rem;
	font-weight: 700;
	line-height: 1.1;
	letter-spacing: -0.035em;
}

.sheet-prose {
	margin: 0;
	font-size: 0.8125rem;
	line-height: 1.55;
	color: var(--muted);
}

.sheet-prose strong {
	color: var(--fg);
	font-weight: 600;
}

.pricing-hero {
	--pricing-accent: #8aad82;
	--pricing-accent-deep: #5a7a52;
	--pricing-gray: #525252;
	--pricing-gray-soft: #a3a3a3;
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	transition: opacity 0.25s ease;
}

.hero-rules {
	--rule-pad-block: 1.05rem;
	--rule-pad-inline: 0.85rem;
	--rule-inner-gap: 0.45rem;
	--rule-min-height: 7.5rem;
	display: flex;
	align-items: stretch;
	border-radius: 1.25rem;
	box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
}

.rule-divider {
	flex-shrink: 0;
	width: 1px;
	align-self: stretch;
	background: color-mix(in srgb, var(--fg) 22%, transparent);
	transform-origin: center center;
}

.rule {
	box-sizing: border-box;
	flex: 1;
	min-width: 0;
	display: grid;
	grid-template-rows: min-content 1fr min-content;
	align-content: center;
	justify-items: center;
	text-align: center;
	gap: var(--rule-inner-gap);
	padding: var(--rule-pad-block) var(--rule-pad-inline);
	min-height: var(--rule-min-height);
	box-shadow: none;
}

.rule--free {
	position: relative;
	overflow: hidden;
	border-radius: 1.25rem 0 0 1.25rem;
	border: 1px solid #525252;
	border-right: none;
	background-color: #3a3a3a;
	background-image: repeating-linear-gradient(
		-42deg,
		#3a3a3a 0,
		#3a3a3a 9px,
		#454545 9px,
		#454545 18px
	);
}

.rule--free > * {
	position: relative;
	z-index: 1;
}

.rule--paid {
	border-radius: 0 1.25rem 1.25rem 0;
	border: 1px solid color-mix(in srgb, var(--pricing-accent) 35%, var(--border));
	border-left: none;
	background: linear-gradient(
		155deg,
		color-mix(in srgb, var(--pricing-accent) 18%, #fff) 0%,
		#fff 55%,
		#fafafa 100%
	);
}

.pricing-or {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	margin: 0;
	font-size: 0.62rem;
	font-weight: 600;
	letter-spacing: 0.14em;
	text-transform: lowercase;
	color: var(--muted-light);
}

.pricing-or::before,
.pricing-or::after {
	content: "";
	flex: 1;
	height: 1px;
	background: color-mix(in srgb, var(--fg) 10%, transparent);
}

.lifetime-below {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.85rem 1rem;
	border-radius: 1.25rem;
	border: 1px solid color-mix(in srgb, var(--pricing-gray) 18%, var(--border));
	background: linear-gradient(
		155deg,
		#f0f0f0 0%,
		#f7f7f7 52%,
		#fafafa 100%
	);
	box-shadow: 0 8px 22px rgba(0, 0, 0, 0.07);
}

.lifetime-below--active {
	border-color: color-mix(in srgb, var(--pricing-gray) 28%, var(--border));
	background: linear-gradient(
		155deg,
		#e8e8e8 0%,
		#f2f2f2 52%,
		#f7f7f7 100%
	);
}

.lifetime-below-main {
	min-width: 0;
	flex: 1;
}

.lifetime-below-kicker {
	margin: 0;
	font-size: 0.62rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--pricing-gray-soft);
}

.lifetime-below--active .lifetime-below-kicker {
	color: color-mix(in srgb, var(--pricing-gray) 55%, var(--muted));
}

.lifetime-below-price {
	margin: 0.2rem 0 0;
	font-family: var(--font-display);
	font-size: 1.65rem;
	font-weight: 800;
	letter-spacing: -0.04em;
	line-height: 1;
	color: var(--fg);
}

.lifetime-below-title {
	margin: 0.2rem 0 0;
	display: flex;
	align-items: center;
	gap: 0.35rem;
	font-family: var(--font-display);
	font-size: 1.05rem;
	font-weight: 700;
	letter-spacing: -0.03em;
	color: var(--fg);
}

.lifetime-below-check {
	font-size: 1.15rem;
	font-weight: 800;
	color: var(--pricing-gray);
}

.lifetime-below-meta {
	margin: 0.25rem 0 0;
	font-size: 0.7rem;
	line-height: 1.4;
	color: var(--muted);
}

.lifetime-below-cta {
	flex-shrink: 0;
	padding: 0.5rem 0.85rem;
	border: none;
	border-radius: var(--radius-pill);
	background: var(--fg);
	color: var(--surface);
	font-size: 0.72rem;
	font-weight: 700;
	cursor: pointer;
	transition: opacity 0.2s ease, transform 0.2s ease;
}

.lifetime-below-cta:hover:not(:disabled) {
	opacity: 0.9;
	transform: translateY(-1px);
}

.lifetime-below-cta:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.lifetime-below-error {
	margin: 0;
	font-size: 0.72rem;
	color: #b42318;
	text-align: center;
}

.rule-kicker {
	margin: 0;
	min-height: 1.35rem;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.62rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	line-height: 1.2;
}

.rule--free .rule-kicker {
	color: rgba(255, 255, 255, 0.55);
}

.rule--paid .rule-kicker {
	color: color-mix(in srgb, var(--pricing-accent-deep) 85%, var(--muted));
}

.rule-value {
	margin: 0;
	width: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	align-self: center;
	gap: 0.12rem;
	min-height: 2.75rem;
	padding-inline: 0.1rem;
	line-height: 1;
}

.rule-num {
	font-family: var(--font-display);
	font-size: 2.45rem;
	font-weight: 800;
	letter-spacing: -0.05em;
	line-height: 1;
	max-width: 100%;
}

.rule--paid .rule-num {
	font-size: clamp(1.85rem, 7.5vw, 2.35rem);
}

.rule--free .rule-value {
	align-items: baseline;
}

.rule--free .rule-num,
.rule--free .rule-unit {
	color: #fff;
}

.rule--paid .rule-num {
	color: var(--fg);
}

.rule-unit {
	font-family: var(--font-display);
	font-size: 1.05rem;
	font-weight: 700;
	letter-spacing: -0.02em;
	line-height: 1;
}

.rule--free .rule-unit {
	opacity: 0.88;
}

.rule-label {
	margin: 0;
	min-height: 1.1rem;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.74rem;
	font-weight: 600;
	line-height: 1.2;
}

.rule--free .rule-label {
	color: rgba(255, 255, 255, 0.72);
}

.rule--paid .rule-label {
	color: var(--muted);
}

.sheet-foot {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	padding-top: 1rem;
	border-top: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
}

.stripe-trust {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.45rem;
}

.stripe-logo {
	display: block;
	width: 3.5rem;
	height: auto;
}

.stripe-copy {
	margin: 0;
	font-size: 0.6875rem;
	line-height: 1.4;
	color: var(--muted-light);
	text-align: center;
}

.note {
	margin: 0;
	font-size: 0.6875rem;
	color: var(--muted-light);
	line-height: 1.45;
	text-align: center;
}

.note a {
	color: var(--muted);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.note a:hover {
	color: var(--fg);
}

.sheet-enter-active {
	transition:
		transform 0.68s cubic-bezier(0.34, 1.22, 0.64, 1),
		opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.sheet-leave-active {
	transition:
		transform 0.32s cubic-bezier(0.4, 0, 0.75, 1),
		opacity 0.22s ease;
}

.sheet-enter-from,
.sheet-leave-to {
	opacity: 0;
	transform: translateX(-50%) translateY(calc(100% + 1.5rem)) scale(0.96);
}

@keyframes sheet-wave-draw {
	from {
		stroke-dashoffset: 1;
	}
	to {
		stroke-dashoffset: 0;
	}
}

@keyframes sheet-head-in {
	from {
		opacity: 0;
		transform: translateX(2rem);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}

@keyframes hero-rules-in {
	from {
		opacity: 0;
		transform: translateX(2.35rem) scale(0.97);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

@keyframes pricing-rtl {
	from {
		opacity: 0;
		transform: translateX(1.65rem);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}

@keyframes pricing-rtl-num {
	from {
		opacity: 0;
		transform: translateX(2.1rem) scale(0.9);
	}
	72% {
		transform: translateX(-0.06rem) scale(1.02);
	}
	to {
		opacity: 1;
		transform: translateX(0) scale(1);
	}
}

@keyframes rule-divider-in {
	from {
		opacity: 0;
		transform: translateX(0.65rem) scaleY(0.12);
	}
	to {
		opacity: 1;
		transform: translateX(0) scaleY(1);
	}
}

@keyframes sheet-foot-in {
	from {
		opacity: 0;
		transform: translateX(1.5rem);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}

@keyframes sheet-x-pop {
	0% {
		opacity: 0;
		transform: scale(0.55) rotate(-90deg);
	}
	70% {
		transform: scale(1.08) rotate(6deg);
	}
	100% {
		opacity: 1;
		transform: scale(1) rotate(0deg);
	}
}

.sheet-enter-active .sheet-wave-border-path {
	stroke-dasharray: 1;
	stroke-dashoffset: 1;
	animation: sheet-wave-draw 0.85s cubic-bezier(0.16, 1, 0.3, 1) 0.18s forwards;
}

.sheet-enter-active .sheet-head {
	animation: sheet-head-in 0.58s cubic-bezier(0.19, 1, 0.22, 1) 0.14s backwards;
}

.sheet-enter-active .sheet-prose {
	animation: pricing-rtl 0.52s cubic-bezier(0.19, 1, 0.22, 1) 0.2s backwards;
}

.sheet-enter-active .hero-rules {
	animation: hero-rules-in 0.6s cubic-bezier(0.19, 1, 0.22, 1) 0.26s backwards;
}

/* Right → left: paid card first, then divider, then free card */
.sheet-enter-active .rule--paid .rule-kicker {
	animation: pricing-rtl 0.48s cubic-bezier(0.19, 1, 0.22, 1) 0.3s backwards;
}

.sheet-enter-active .rule--paid .rule-num {
	animation: pricing-rtl-num 0.56s cubic-bezier(0.19, 1, 0.22, 1) 0.34s backwards;
}

.sheet-enter-active .rule--paid .rule-label {
	animation: pricing-rtl 0.44s cubic-bezier(0.19, 1, 0.22, 1) 0.38s backwards;
}

.sheet-enter-active .rule-divider {
	transform-origin: center center;
	animation: rule-divider-in 0.42s cubic-bezier(0.19, 1, 0.22, 1) 0.42s backwards;
}

.sheet-enter-active .rule--free .rule-kicker {
	animation: pricing-rtl 0.48s cubic-bezier(0.19, 1, 0.22, 1) 0.46s backwards;
}

.sheet-enter-active .rule--free .rule-num {
	animation: pricing-rtl-num 0.56s cubic-bezier(0.19, 1, 0.22, 1) 0.5s backwards;
}

.sheet-enter-active .rule--free .rule-unit {
	animation: pricing-rtl 0.4s cubic-bezier(0.19, 1, 0.22, 1) 0.54s backwards;
}

.sheet-enter-active .rule--free .rule-label {
	animation: pricing-rtl 0.44s cubic-bezier(0.19, 1, 0.22, 1) 0.58s backwards;
}

.sheet-enter-active .pricing-or {
	animation: pricing-rtl 0.4s cubic-bezier(0.19, 1, 0.22, 1) 0.5s backwards;
}

.sheet-enter-active .lifetime-below {
	animation: hero-rules-in 0.55s cubic-bezier(0.19, 1, 0.22, 1) 0.56s backwards;
}

.sheet-enter-active .stripe-trust,
.sheet-enter-active .sheet-foot .note {
	animation: sheet-foot-in 0.5s cubic-bezier(0.19, 1, 0.22, 1) backwards;
}

.sheet-enter-active .stripe-trust {
	animation-delay: 0.62s;
}

.sheet-enter-active .sheet-foot .note {
	animation-delay: 0.66s;
}

.sheet-enter-active .x {
	animation: sheet-x-pop 0.5s cubic-bezier(0.34, 1.28, 0.64, 1) 0.62s backwards;
}

@media (prefers-reduced-motion: reduce) {
	.scrim-enter-active,
	.scrim-leave-active,
	.sheet-enter-active,
	.sheet-leave-active {
		transition-duration: 0.01ms !important;
	}

	.sheet-enter-active .sheet-wave-border-path,
	.sheet-enter-active .sheet-head,
	.sheet-enter-active .hero-rules,
	.sheet-enter-active .rule-divider,
	.sheet-enter-active .rule-kicker,
	.sheet-enter-active .rule-num,
	.sheet-enter-active .rule-unit,
	.sheet-enter-active .rule-label,
	.sheet-enter-active .pricing-or,
	.sheet-enter-active .lifetime-below,
	.sheet-enter-active .sheet-prose,
	.sheet-enter-active .stripe-trust,
	.sheet-enter-active .sheet-foot .note,
	.sheet-enter-active .x {
		animation: none !important;
	}

	.sheet-enter-from,
	.sheet-leave-to {
		transform: translateX(-50%) translateY(100%);
	}
}

.sheet-wave-border {
	display: none;
}

@media (min-width: 720px) {
	.sheet-side {
		top: 0;
		right: 0;
		bottom: 0;
		left: auto;
		width: min(500px, 96vw);
		height: 100%;
		max-height: 100%;
		border-radius: 0;
		box-shadow: none;
		background: var(--surface);
		clip-path: url(#pricing-zebra-clip);
		filter: drop-shadow(-16px 0 36px rgba(0, 0, 0, 0.07));
		transform: none;
		transform-origin: right center;
	}

	.sheet-enter-active.sheet-side {
		transition:
			transform 0.72s cubic-bezier(0.34, 1.2, 0.64, 1),
			opacity 0.48s cubic-bezier(0.16, 1, 0.3, 1),
			filter 0.72s ease;
	}

	.sheet-leave-active.sheet-side {
		transition:
			transform 0.3s cubic-bezier(0.45, 0, 0.85, 1),
			opacity 0.2s ease,
			filter 0.25s ease;
	}

	.sheet-wave-border {
		display: block;
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 2;
	}

	.sheet-inner {
		--sheet-wave-strip: 22%;
		--sheet-pad-block: 2rem;
		--sheet-pad-inline: 1.85rem;
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		padding: var(--sheet-pad-block) var(--sheet-pad-inline) var(--sheet-pad-block)
			calc(var(--sheet-wave-strip) + 1.75rem);
	}

	.sheet-body {
		gap: 1.2rem;
	}

	.sheet-main {
		gap: 1.05rem;
	}

	.hero-rules {
		--rule-pad-block: 1.15rem;
		--rule-pad-inline: 0.75rem;
		--rule-inner-gap: 0.5rem;
		--rule-min-height: 8.5rem;
	}

	.rule--free .rule-num {
		font-size: 2.65rem;
	}

	.rule--paid .rule-num {
		font-size: clamp(2rem, 5vw, 2.45rem);
	}

	.rule-value {
		min-height: 3rem;
	}

	h2 {
		font-size: 1.75rem;
	}

	.sheet-prose {
		font-size: 0.8375rem;
	}

	.sheet-enter-from.sheet-side,
	.sheet-leave-to.sheet-side {
		opacity: 0;
		transform: translateX(calc(108% + 0.5rem)) rotateY(-6deg) scale(0.94);
		filter: drop-shadow(-4px 0 12px rgba(0, 0, 0, 0));
	}

	.sheet-enter-to.sheet-side,
	.sheet-leave-from.sheet-side {
		filter: drop-shadow(-16px 0 36px rgba(0, 0, 0, 0.07));
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet-enter-from.sheet-side,
		.sheet-leave-to.sheet-side {
			transform: translateX(100%);
			filter: none;
		}
	}
}
</style>
