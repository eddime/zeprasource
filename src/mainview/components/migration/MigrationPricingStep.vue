<script setup lang="ts">
import { computed, onMounted } from "vue";
import type { MigrationSizeEstimate } from "../../../shared/types";
import { formatMigrationDurationHint } from "../../../shared/migration-duration";
import { getBillableBreakdown } from "../../../shared/pricing";
import { usePricingStore } from "../../stores/pricing";
import SetupStepHero from "../setup/SetupStepHero.vue";
import AppDock from "../ui/AppDock.vue";

const LIFETIME_COPY = {
	kicker: "Own Zepra forever",
	meta: "Unlimited runs · one-time purchase",
	cta: "Get Lifetime instead",
} as const;

const props = defineProps<{
	estimate: MigrationSizeEstimate;
	loading?: boolean;
	stripeConfigured?: boolean;
	paymentError?: string | null;
}>();

const emit = defineEmits<{
	back: [];
	continue: [];
	lifetime: [];
}>();

const pricing = usePricingStore();

onMounted(() => {
	void pricing.ensureLoaded(true);
	void pricing.refreshEntitlement(true);
});

const showLifetimeOffer = computed(
	() => pricing.lifetimeReady && !pricing.hasLifetime,
);

const lifetimePrice = computed(() => pricing.lifetimeCatalog.priceLabel);

const catalog = computed(() => pricing.activeCatalog);

const breakdown = computed(() => {
	const c = catalog.value;
	return c ? getBillableBreakdown(props.estimate.totalBytes, c) : null;
});

const freeLimitGb = computed(
	() => catalog.value?.freeLimitGb ?? props.estimate.freeLimitBytes / 1024 ** 3,
);

const freeLimitBytes = computed(
	() => catalog.value?.freeLimitBytes ?? props.estimate.freeLimitBytes,
);

const folderCount = computed(() => props.estimate.folders.length);

const freeZonePercent = computed(() =>
	Math.max(
		22,
		Math.min(72, (freeLimitBytes.value / props.estimate.totalBytes) * 100),
	),
);

const messageLabel = computed(() =>
	props.estimate.messageCount === 1
		? "1 email"
		: `${props.estimate.messageCount.toLocaleString()} emails`,
);

const heroSubline = computed(() => {
	const label = catalog.value?.pricePerGbLabel;
	if (!label) {
		return "Pay once for the gigabytes you move — no subscription.";
	}
	return `Over ${freeLimitGb.value} GB: pay once for the gigabytes you move (${label}).`;
});

const payLabel = computed(() => {
	if (props.loading) return "Waiting for payment…";
	if (!pricing.isReady) return "Continue";
	return "Continue to payment";
});

const canPay = computed(
	() =>
		pricing.isReady &&
		props.stripeConfigured !== false &&
		!props.loading &&
		breakdown.value != null,
);
</script>

<template>
	<div class="setup-pricing">
		<div class="pricing-scroll">
			<SetupStepHero
				eyebrow="Before migration"
				title="Pay for this run"
				:subline="heroSubline"
				show-back
				@back="emit('back')"
			/>

			<section
				class="ticket"
				:class="{ 'ticket--waiting': loading }"
				aria-labelledby="ticket-heading"
			>
				<header class="ticket-head">
					<div class="ticket-head-copy">
						<p id="ticket-heading" class="ticket-eyebrow">This migration</p>
						<p class="ticket-tier">Pay once</p>
					</div>
					<div class="stat-chips" aria-label="Selection">
						<span class="chip">{{ folderCount }} folders</span>
						<span class="chip">{{ messageLabel }}</span>
						<span class="chip chip-accent">{{ breakdown?.totalLabel ?? "—" }}</span>
					</div>
				</header>

				<div
					v-if="breakdown"
					class="charge-block"
					role="status"
					:style="{ '--free-zone': `${freeZonePercent}%` }"
					:aria-label="`${breakdown.totalLabel} selected. ${freeLimitGb} GB free. Plus ${breakdown.billableGb} GB. ${breakdown.priceLabel} once.`"
				>
					<div class="charge-block-free">
						<span class="charge-block-free-tag">Free {{ freeLimitGb }} GB</span>
					</div>
					<div class="charge-block-paid">
						<p class="charge-caption">
							+{{ breakdown.billableGb }} GB × {{ breakdown.unitPriceLabel }} =
							{{ breakdown.priceLabel }}
						</p>
						<p class="charge-price">{{ breakdown.priceLabel }}</p>
						<p class="charge-sub">No subscription</p>
					</div>
				</div>

				<div class="time-row">
					<span class="time-label">Est. time</span>
					<span class="time-value">{{ formatMigrationDurationHint(estimate) }}</span>
				</div>

				<p v-if="loading" class="pay-wait" role="status">
					<span class="pay-wait-dot" aria-hidden="true" />
					Finish payment in your browser — this screen updates when Stripe confirms.
				</p>

				<ul v-else class="fine-list">
					<li>Only for the folders you selected</li>
					<li>Copied locally — source mail is not deleted</li>
					<li>Stripe opens in your browser, then migration starts here</li>
				</ul>
			</section>

			<template v-if="showLifetimeOffer && !loading">
				<p class="pricing-or" aria-hidden="true">or</p>
				<section class="lifetime-nudge" aria-label="Zepra Lifetime">
					<div class="lifetime-nudge-main">
						<p class="lifetime-nudge-kicker">{{ LIFETIME_COPY.kicker }}</p>
						<p class="lifetime-nudge-price">{{ lifetimePrice }}</p>
						<p class="lifetime-nudge-meta">{{ LIFETIME_COPY.meta }}</p>
					</div>
					<button
						v-if="pricing.lifetimeCheckoutReady"
						type="button"
						class="lifetime-nudge-cta"
						:disabled="pricing.lifetimeLoading"
						@click="emit('lifetime')"
					>
						{{
							pricing.lifetimeLoading
								? "Waiting…"
								: LIFETIME_COPY.cta
						}}
					</button>
				</section>
			</template>

			<p v-if="paymentError" class="inline-note error">{{ paymentError }}</p>
		</div>

		<AppDock
			:label="payLabel"
			:disabled="!canPay"
			:loading="loading"
			@action="emit('continue')"
		/>
	</div>
</template>

<style scoped>
.setup-pricing {
	height: 100%;
	width: 100%;
	align-self: stretch;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.pricing-scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.65rem;
	padding: 0 0 var(--app-dock-h-hover);
	scrollbar-width: thin;
}

.ticket {
	flex-shrink: 0;
	padding: 1rem 1.05rem 0.9rem;
	border-radius: 20px;
	border: 1px solid var(--border);
	background: var(--surface);
	background-image: radial-gradient(
		circle at 100% 0%,
		color-mix(in srgb, #8aad82 16%, transparent) 0%,
		transparent 48%
	);
	box-shadow:
		0 8px 32px rgba(0, 0, 0, 0.05),
		0 1px 0 rgba(255, 255, 255, 0.8) inset;
	animation: ticket-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.ticket--waiting {
	border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
}

@keyframes ticket-in {
	from {
		opacity: 0;
		transform: translateY(6px);
	}
	to {
		opacity: 1;
		transform: none;
	}
}

.ticket-head {
	position: sticky;
	top: 0;
	z-index: 1;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.85rem;
	margin: -1rem -1.05rem 0;
	padding: 1rem 1.05rem 0.65rem;
	background: var(--surface);
	border-radius: 20px 20px 0 0;
	box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 65%, transparent);
}

.ticket-head-copy {
	min-width: 0;
	flex: 1;
}

.ticket-eyebrow {
	margin: 0;
	font-size: 0.68rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--muted);
}

.ticket-tier {
	margin: 0.2rem 0 0;
	font-family: var(--font-display);
	font-size: 1.65rem;
	font-weight: 700;
	letter-spacing: -0.04em;
	line-height: 1;
	color: var(--fg);
}

.stat-chips {
	margin: 0;
	flex-shrink: 0;
	display: flex;
	flex-flow: row nowrap;
	justify-content: flex-end;
	gap: 0.3rem;
}

.chip {
	padding: 0.24rem 0.5rem;
	border-radius: var(--radius-pill);
	font-size: 0.62rem;
	font-weight: 600;
	white-space: nowrap;
	color: var(--muted);
	background: color-mix(in srgb, var(--fg) 4%, transparent);
	border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
}

.chip-accent {
	color: var(--fg);
	background: color-mix(in srgb, #8aad82 12%, transparent);
	border-color: color-mix(in srgb, #8aad82 28%, transparent);
}

.charge-block {
	margin-top: 0.9rem;
	display: grid;
	grid-template-columns: var(--free-zone, 35%) minmax(0, 1fr);
	align-items: stretch;
	min-height: 5.5rem;
	border-radius: 14px;
	overflow: hidden;
	border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
	background: var(--surface);
}

.charge-block-free {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0.85rem 0.55rem;
	background: color-mix(in srgb, var(--fg) 4%, transparent);
	border-right: 1px dashed color-mix(in srgb, var(--fg) 18%, transparent);
}

.charge-block-free-tag {
	font-size: 0.62rem;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--muted);
	text-align: center;
	line-height: 1.3;
}

.charge-block-paid {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.15rem;
	padding: 0.85rem 0.95rem;
	text-align: center;
	background: linear-gradient(
		155deg,
		color-mix(in srgb, #8aad82 18%, #fff) 0%,
		#fff 55%,
		color-mix(in srgb, #8aad82 8%, #fafafa) 100%
	);
}

.charge-caption {
	margin: 0;
	font-size: 0.65rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: color-mix(in srgb, #5a7a52 75%, var(--muted));
}

.charge-price {
	margin: 0;
	font-family: var(--font-display);
	font-size: 2.35rem;
	font-weight: 700;
	letter-spacing: -0.05em;
	line-height: 1;
	color: var(--fg);
}

.charge-sub {
	margin: 0;
	font-size: 0.68rem;
	color: color-mix(in srgb, #5a7a52 70%, var(--muted));
}

.time-row {
	margin-top: 0.75rem;
	padding-top: 0.65rem;
	border-top: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	font-size: 0.74rem;
}

.time-label {
	color: var(--muted);
	font-weight: 500;
}

.time-value {
	font-weight: 700;
	color: var(--fg);
	text-align: right;
}

.time-range {
	font-weight: 500;
	color: var(--muted);
}

.pay-wait {
	margin: 0.75rem 0 0;
	padding: 0.6rem 0.7rem;
	display: flex;
	align-items: flex-start;
	gap: 0.5rem;
	border-radius: 12px;
	font-size: 0.72rem;
	line-height: 1.45;
	color: var(--fg);
	background: color-mix(in srgb, var(--fg) 5%, transparent);
	border: 1px solid color-mix(in srgb, var(--fg) 14%, transparent);
}

.pay-wait-dot {
	flex-shrink: 0;
	width: 0.45rem;
	height: 0.45rem;
	margin-top: 0.35rem;
	border-radius: 50%;
	background: var(--fg);
	animation: wait-pulse 1.1s ease-in-out infinite;
}

@keyframes wait-pulse {
	0%,
	100% {
		opacity: 0.35;
		transform: scale(0.9);
	}
	50% {
		opacity: 1;
		transform: scale(1);
	}
}

.fine-list {
	margin: 0.75rem 0 0;
	padding: 0;
	list-style: none;
	display: flex;
	flex-direction: column;
	gap: 0.32rem;
}

.fine-list li {
	font-size: 0.68rem;
	line-height: 1.4;
	color: var(--muted);
	padding-left: 0.8rem;
	position: relative;
}

.fine-list li::before {
	content: "";
	position: absolute;
	left: 0;
	top: 0.5em;
	width: 3px;
	height: 3px;
	border-radius: 50%;
	background: color-mix(in srgb, var(--fg) 28%, transparent);
}

.inline-note {
	margin: 0;
	padding: 0 0.15rem;
	font-size: 0.72rem;
	line-height: 1.4;
}

.inline-note.warn {
	color: var(--muted);
}

.inline-note.warn code {
	font-size: 0.68rem;
}

.inline-note.error {
	color: #b42318;
}

.pricing-or {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	margin: 0.15rem 0 0;
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

.lifetime-nudge {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.85rem 1rem;
	border-radius: 1.25rem;
	border: 1px solid color-mix(in srgb, #525252 18%, var(--border));
	background: linear-gradient(
		155deg,
		#f0f0f0 0%,
		#f7f7f7 52%,
		#fafafa 100%
	);
	box-shadow: 0 8px 22px rgba(0, 0, 0, 0.07);
}

.lifetime-nudge-main {
	min-width: 0;
	flex: 1;
}

.lifetime-nudge-kicker {
	margin: 0;
	font-size: 0.62rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--muted-light);
}

.lifetime-nudge-price {
	margin: 0.2rem 0 0;
	font-family: var(--font-display);
	font-size: 1.5rem;
	font-weight: 800;
	letter-spacing: -0.04em;
	line-height: 1;
	color: var(--fg);
}

.lifetime-nudge-meta {
	margin: 0.25rem 0 0;
	font-size: 0.68rem;
	line-height: 1.4;
	color: var(--muted);
}

.lifetime-nudge-cta {
	flex-shrink: 0;
	padding: 0.5rem 0.85rem;
	border: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
	border-radius: var(--radius-pill);
	background: var(--surface);
	color: var(--fg);
	font-size: 0.68rem;
	font-weight: 700;
	cursor: pointer;
	transition: opacity 0.2s ease, transform 0.2s ease;
}

.lifetime-nudge-cta:hover:not(:disabled) {
	opacity: 0.9;
	transform: translateY(-1px);
}

.lifetime-nudge-cta:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
	.ticket {
		animation: none;
	}

	.pay-wait-dot {
		animation: none;
		opacity: 0.7;
	}
}
</style>
