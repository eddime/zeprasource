<script setup lang="ts">
import { watch } from "vue";
import stripeWordmark from "@/assets/stripe-wordmark.svg";
import { BACKUP_COPY } from "../../../shared/backup-copy";
import { PRICING_TIER_LIMITS_GB } from "../../../shared/pricing";
import { usePricingStore } from "../../stores/pricing";

const open = defineModel<boolean>("open", { default: false });
const pricing = usePricingStore();

watch(open, (isOpen) => {
	if (isOpen) void pricing.ensureLoaded();
});

function close() {
	open.value = false;
}
</script>

<template>
	<svg class="sheet-clip-svg" aria-hidden="true" focusable="false">
		<defs>
			<clipPath id="pricing-zebra-clip" clipPathUnits="objectBoundingBox">
				<!-- Three soft waves in left strip; straight edge at 22% for content padding -->
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
				aria-label="Close pricing"
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
					<header class="sheet-head">
						<h2 id="pricing-title">Pricing</h2>
						<p class="lead">
							Let's be fair: who wants a subscription just to move email?
						</p>
						<p class="lead lead-2">
							<strong>{{ PRICING_TIER_LIMITS_GB.free }} GB free</strong> per migration, enough
							for most. Bigger mailbox? Fair <strong>one-time payment</strong>. No stress, as it
							should be.
						</p>
						<p class="lead lead-backup">{{ BACKUP_COPY.pricingLead }}</p>
					</header>

					<p v-if="pricing.loading" class="plans-loading">Loading prices from Stripe…</p>

					<ul class="plans" :class="{ 'is-loading': pricing.loading }">
						<li
							v-for="plan in pricing.plans"
							:key="plan.id"
							class="plan"
							:class="[
								`plan--${plan.id}`,
								{ 'plan--featured': plan.id === 'starter' },
							]"
						>
							<span class="plan-badge">{{ plan.sizeLabel }}</span>
							<div class="plan-body">
								<div class="plan-copy">
									<h3>{{ plan.name }}</h3>
									<p v-if="plan.tagline" class="tagline">{{ plan.tagline }}</p>
								</div>
								<p
									class="price"
									:class="{ 'price--free': plan.id === 'free' }"
								>
									{{ plan.id === 'free' ? 'Free' : plan.priceLabel }}
								</p>
							</div>
						</li>
					</ul>

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
							Part of every paid license supports
							<a
								href="https://www.marwell.org.uk/save-our-stripes/"
								target="_blank"
								rel="noopener noreferrer"
							>Save Our Stripes</a>
							at Marwell Wildlife.
						</p>
					</footer>
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
	height: 100%;
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: 0.9rem;
	padding: 1.5rem 1.3rem 1.35rem;
	box-sizing: border-box;
	min-height: 0;
	background: linear-gradient(
		165deg,
		#fff 0%,
		#fafafa 42%,
		#f5f5f5 100%
	);
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
	margin: 0 0 0.5rem;
	font-size: 1.55rem;
	font-weight: 700;
	line-height: 1.1;
	letter-spacing: -0.035em;
}

.lead {
	margin: 0;
	font-size: 0.8125rem;
	line-height: 1.48;
	color: var(--muted);
}

.lead-2 {
	margin-top: 0.45rem;
}

.lead-backup {
	margin-top: 0.4rem;
	font-size: 0.78rem;
}

.lead strong {
	color: var(--fg);
	font-weight: 600;
}

.plans-loading {
	margin: 0;
	font-size: 0.72rem;
	color: var(--muted);
	text-align: center;
}

.plans.is-loading {
	opacity: 0.55;
	pointer-events: none;
}

.plans {
	list-style: none;
	margin: 0;
	padding: 0;
	flex: 1 1 auto;
	min-height: 0;
	display: grid;
	grid-template-columns: 1fr 1fr;
	grid-template-rows: 1fr 1fr;
	gap: 0.6rem;
	align-content: stretch;
}

.plan {
	position: relative;
	border: 1px solid var(--border);
	border-radius: var(--radius-card);
	padding: 0.75rem 0.75rem 0.7rem;
	background: var(--surface);
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: 0.35rem;
	min-height: 0;
	height: 100%;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.04);
	transition:
		border-color 0.2s ease,
		box-shadow 0.2s ease,
		transform 0.2s ease;
}

.plan:hover {
	transform: translateY(-1px);
	box-shadow: 0 12px 36px rgba(0, 0, 0, 0.06);
}

.plan-badge {
	align-self: flex-start;
	display: inline-block;
	padding: 0.18rem 0.5rem;
	border-radius: var(--radius-pill);
	font-size: 0.6rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--muted);
	background: var(--btn-secondary);
	line-height: 1.2;
}

.plan-body {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: 0.4rem;
	flex: 1;
	min-height: 0;
}

.plan-copy {
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
}

.plan h3 {
	margin: 0;
	font-family: var(--font-display);
	font-size: 0.875rem;
	font-weight: 700;
	line-height: 1.15;
	letter-spacing: -0.02em;
}

.tagline {
	margin: 0;
	font-size: 0.6875rem;
	color: var(--muted-light);
	line-height: 1.35;
}

.price {
	margin: 0;
	font-family: var(--font-display);
	font-size: 1.35rem;
	font-weight: 800;
	letter-spacing: -0.04em;
	line-height: 1;
}

.plan--free {
	border: 1px solid #525252;
	background: repeating-linear-gradient(
		-42deg,
		#3a3a3a,
		#3a3a3a 9px,
		#454545 9px,
		#454545 18px
	);
	box-shadow: 0 12px 36px rgba(0, 0, 0, 0.16);
}

.plan--free:hover {
	transform: translateY(-1px);
	box-shadow: 0 16px 44px rgba(0, 0, 0, 0.22);
	border-color: #5c5c5c;
}

.plan--free .plan-badge {
	color: #fff;
	background: rgba(255, 255, 255, 0.12);
	border: 1px solid rgba(255, 255, 255, 0.22);
	font-weight: 700;
}

.plan--free h3 {
	color: #fff;
}

.plan--free .tagline {
	color: rgba(255, 255, 255, 0.62);
}

.plan--free .price {
	color: #fff;
}

.plan--plus {
	border-color: #e8e8e8;
}

.plan--starter.plan--featured {
	border-color: var(--fg);
	box-shadow: var(--shadow-soft);
}

.plan--pro {
	border-color: #d4d4d4;
	background: linear-gradient(160deg, #fff 0%, #fafafa 55%, #f4f4f4 100%);
}

.plan--pro .plan-badge {
	color: var(--muted);
	background: var(--btn-secondary);
}

.sheet-foot {
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	gap: 0.85rem;
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
		transform: translateX(-18px);
	}

	to {
		opacity: 1;
		transform: translateX(0);
	}
}

@keyframes sheet-card-deal {
	from {
		opacity: 0;
		transform: translateX(22px) scale(0.94) rotate(2deg);
	}

	to {
		opacity: 1;
		transform: translateX(0) scale(1) rotate(0deg);
	}
}

@keyframes sheet-foot-in {
	from {
		opacity: 0;
		transform: translateY(10px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
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
	animation: sheet-head-in 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
}

.sheet-enter-active .plan {
	animation: sheet-card-deal 0.5s cubic-bezier(0.34, 1.18, 0.64, 1) backwards;
}

.sheet-enter-active .plan:nth-child(1) {
	animation-delay: 0.28s;
}

.sheet-enter-active .plan:nth-child(2) {
	animation-delay: 0.34s;
}

.sheet-enter-active .plan:nth-child(3) {
	animation-delay: 0.4s;
}

.sheet-enter-active .plan:nth-child(4) {
	animation-delay: 0.46s;
}

.sheet-enter-active .stripe-trust,
.sheet-enter-active .sheet-foot .note {
	animation: sheet-foot-in 0.48s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

.sheet-enter-active .stripe-trust {
	animation-delay: 0.52s;
}

.sheet-enter-active .sheet-foot .note {
	animation-delay: 0.58s;
}

.sheet-enter-active .x {
	animation: sheet-x-pop 0.5s cubic-bezier(0.34, 1.28, 0.64, 1) 0.62s backwards;
}

@media (prefers-reduced-motion: reduce) {
	.scrim-enter-active,
	.scrim-leave-active {
		transition-duration: 0.01ms !important;
	}

	.sheet-enter-active,
	.sheet-leave-active {
		transition-duration: 0.01ms !important;
	}

	.sheet-enter-active .sheet-wave-border-path,
	.sheet-enter-active .sheet-head,
	.sheet-enter-active .plan,
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
		--sheet-pad-block: 2.35rem;
		position: relative;
		z-index: 1;
		box-sizing: border-box;
		justify-content: space-between;
		padding: var(--sheet-pad-block) 2.1rem var(--sheet-pad-block)
			calc(var(--sheet-wave-strip) + 2rem);
		gap: 0.75rem;
	}

	.plans {
		flex: 0 0 auto;
		width: 100%;
		gap: 0.6rem;
		grid-template-rows: repeat(2, 8.35rem);
		align-content: stretch;
	}

	.plan {
		height: 100%;
		min-height: 0;
		padding: 0.78rem 0.75rem 0.72rem;
		border-radius: 1.35rem;
		gap: 0.3rem;
	}

	.plan-body {
		gap: 0.35rem;
	}

	.plan--pro {
		border-radius: 1.5rem;
	}

	h2 {
		font-size: 1.75rem;
	}

	.lead {
		font-size: 0.8375rem;
	}

	.price {
		font-size: 1.35rem;
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
