<script setup lang="ts">
import { computed, onMounted } from "vue";
import type { MigrationSizeEstimate } from "../../../shared/types";
import {
	FREE_MIGRATION_LIMIT_BYTES,
	PRICING_TIER_LIMITS_GB,
	formatBytes,
} from "../../../shared/pricing";
import { usePricingStore } from "../../stores/pricing";
import SetupStepHero from "../setup/SetupStepHero.vue";
import AppDock from "../ui/AppDock.vue";

const props = defineProps<{
	estimate: MigrationSizeEstimate;
	loading?: boolean;
	stripeConfigured?: boolean;
	paymentError?: string | null;
}>();

const emit = defineEmits<{
	back: [];
	continue: [];
}>();

const pricing = usePricingStore();

onMounted(() => {
	void pricing.ensureLoaded(true);
});

const tier = computed(() => pricing.tierForBytes(props.estimate.totalBytes));

const planMeta = computed(() =>
	pricing.plans.find((plan) => plan.id === tier.value.id),
);

const folderCount = computed(() => props.estimate.folders.length);

const freeLimitLabel = computed(() => formatBytes(FREE_MIGRATION_LIMIT_BYTES));

const freeZonePercent = computed(() =>
	Math.max(
		22,
		Math.min(72, (FREE_MIGRATION_LIMIT_BYTES / props.estimate.totalBytes) * 100),
	),
);

const messageLabel = computed(() =>
	props.estimate.messageCount === 1
		? "1 email"
		: `${props.estimate.messageCount.toLocaleString()} emails`,
);

const planValue = computed(() => planMeta.value?.sizeLabel ?? "");

const heroSubline = computed(
	() =>
		`Over ${PRICING_TIER_LIMITS_GB.free} GB needs a one-time license before the copy starts.`,
);

const payLabel = computed(() => {
	if (props.loading) return "Waiting for payment…";
	if (props.stripeConfigured === false) return "Stripe not configured";
	return "Continue to Stripe";
});

const canPay = computed(() => props.stripeConfigured !== false && !props.loading);
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

			<div
				class="size-meter"
				role="status"
				:style="{ '--free-zone': `${freeZonePercent}%` }"
				:aria-label="`Selection is above the free ${freeLimitLabel} limit`"
			>
				<div class="meter-zone meter-zone-free">
					<span class="meter-tag">Free {{ PRICING_TIER_LIMITS_GB.free }} GB</span>
				</div>
				<div class="meter-zone meter-zone-over">
					<span class="meter-value">{{ formatBytes(estimate.totalBytes) }}</span>
					<span class="meter-plan">{{ tier.name }}</span>
				</div>
			</div>

			<section
				class="ticket"
				:class="{ 'ticket--waiting': loading }"
				aria-labelledby="ticket-heading"
			>
				<header class="ticket-head">
					<div class="ticket-head-copy">
						<p id="ticket-heading" class="ticket-eyebrow">Migration license</p>
						<p class="ticket-tier">{{ tier.name }}</p>
					</div>
					<span v-if="planValue" class="tier-cap">{{ planValue }}</span>
				</header>

				<div class="stat-chips" aria-label="Selection">
					<span class="chip">{{ folderCount }} folders</span>
					<span class="chip">{{ messageLabel }}</span>
					<span class="chip chip-accent">{{ formatBytes(estimate.totalBytes) }}</span>
				</div>

				<div class="charge-block">
					<p class="charge-caption">One-time</p>
					<p class="charge-price">{{ tier.priceLabel }}</p>
					<p class="charge-sub">No subscription</p>
				</div>

				<div class="time-row">
					<span class="time-label">Est. time</span>
					<span class="time-value">
						{{ estimate.durationLabel }}
						<span class="time-range">({{ estimate.durationRangeLabel }})</span>
					</span>
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

			<p v-if="stripeConfigured === false" class="inline-note warn">
				Add <code>STRIPE_SECRET_KEY</code> to <code>mailport/.env</code> and restart.
			</p>
			<p v-else-if="paymentError" class="inline-note error">{{ paymentError }}</p>
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

.size-meter {
	flex-shrink: 0;
	display: grid;
	grid-template-columns: var(--free-zone, 35%) minmax(0, 1fr);
	align-items: stretch;
	min-height: 2.35rem;
	border-radius: var(--radius-pill);
	border: 1px solid color-mix(in srgb, var(--fg) 10%, transparent);
	background: color-mix(in srgb, var(--surface) 55%, transparent);
	backdrop-filter: blur(10px);
	-webkit-backdrop-filter: blur(10px);
	box-shadow: 0 1px 0 rgba(255, 255, 255, 0.65) inset;
	overflow: hidden;
}

.meter-zone {
	display: flex;
	align-items: center;
	min-width: 0;
}

.meter-zone-free {
	justify-content: center;
	padding: 0.45rem 0.55rem;
	background: color-mix(in srgb, var(--fg) 5%, transparent);
	border-right: 1px dashed color-mix(in srgb, var(--fg) 18%, transparent);
}

.meter-zone-over {
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.45rem 0.75rem;
	background: color-mix(in srgb, #8aad82 14%, transparent);
}

.meter-tag {
	font-size: 0.62rem;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--muted);
	white-space: nowrap;
}

.meter-value {
	font-size: 0.82rem;
	font-weight: 800;
	letter-spacing: -0.02em;
	color: var(--fg);
}

.meter-plan {
	flex-shrink: 0;
	padding: 0.15rem 0.5rem;
	border-radius: var(--radius-pill);
	font-size: 0.62rem;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: var(--fg);
	background: color-mix(in srgb, var(--surface) 70%, transparent);
	border: 1px solid color-mix(in srgb, var(--fg) 10%, transparent);
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
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.75rem;
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

.tier-cap {
	flex-shrink: 0;
	margin-top: 0.15rem;
	padding: 0.28rem 0.55rem;
	border-radius: var(--radius-pill);
	font-size: 0.62rem;
	font-weight: 600;
	color: var(--muted);
	border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
	background: color-mix(in srgb, var(--fg) 3%, transparent);
}

.stat-chips {
	margin-top: 0.85rem;
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
}

.chip {
	padding: 0.28rem 0.55rem;
	border-radius: var(--radius-pill);
	font-size: 0.68rem;
	font-weight: 600;
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
	padding: 0.85rem 0.95rem;
	border-radius: 14px;
	text-align: center;
	background: color-mix(in srgb, var(--fg) 4%, transparent);
	border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
}

.charge-caption {
	margin: 0;
	font-size: 0.65rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--muted);
}

.charge-price {
	margin: 0.2rem 0 0;
	font-family: var(--font-display);
	font-size: 2.35rem;
	font-weight: 700;
	letter-spacing: -0.05em;
	line-height: 1;
	color: var(--fg);
}

.charge-sub {
	margin: 0.35rem 0 0;
	font-size: 0.68rem;
	color: var(--muted);
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
