<script setup lang="ts">
import { computed, onMounted } from "vue";
import stripeWordmark from "@/assets/stripe-wordmark.svg";
import {
	FREE_MIGRATION_LIMIT_BYTES,
	PRICING_TIER_LIMITS_GB,
	formatBytes,
	requiresPaidPlan,
} from "../../../shared/pricing";
import { usePricingStore } from "../../stores/pricing";

const props = defineProps<{
	selectedBytes: number;
	loadingStats?: boolean;
	hasSelection?: boolean;
}>();

const pricing = usePricingStore();

onMounted(() => {
	void pricing.ensureLoaded();
});

const tier = computed(() => pricing.tierForBytes(props.selectedBytes));

const showPaid = computed(
	() =>
		!props.loadingStats &&
		props.hasSelection !== false &&
		props.selectedBytes > 0 &&
		requiresPaidPlan(props.selectedBytes),
);

const showFree = computed(
	() =>
		!props.loadingStats &&
		props.hasSelection !== false &&
		props.selectedBytes > 0 &&
		!requiresPaidPlan(props.selectedBytes),
);

const freeLimitLabel = computed(() => formatBytes(FREE_MIGRATION_LIMIT_BYTES));

const overBytes = computed(() =>
	Math.max(0, props.selectedBytes - FREE_MIGRATION_LIMIT_BYTES),
);

/** Share of the pill reserved for the free tier (rest = over limit). */
const freeZonePercent = computed(() =>
	Math.max(22, Math.min(72, (FREE_MIGRATION_LIMIT_BYTES / props.selectedBytes) * 100)),
);

const barAriaLabel = computed(
	() =>
		`Above the free limit. ${formatBytes(props.selectedBytes)} selected. Free up to ${freeLimitLabel.value}. ${formatBytes(overBytes.value)} over.`,
);
</script>

<template>
	<Transition name="plan-notice" mode="out-in">
		<div
			v-if="showPaid"
			key="paid"
			class="paid-notice"
			role="status"
			:aria-label="barAriaLabel"
			:style="{ '--free-zone': `${freeZonePercent}%` }"
		>
			<div class="paid-zone paid-zone-free">
				<span class="paid-label">Over {{ freeLimitLabel }}</span>
			</div>
			<div class="paid-zone paid-zone-over">
				<span class="paid-copy">
					<strong>{{ formatBytes(selectedBytes) }}</strong>
					· {{ tier.name }} <strong>{{ tier.priceLabel }}</strong> once
				</span>
				<span class="paid-stripe">
					<img
						:src="stripeWordmark"
						width="42"
						height="18"
						alt="Stripe"
						decoding="async"
					/>
				</span>
			</div>
		</div>

		<p v-else-if="showFree" key="free" class="free-notice" role="status">
			<strong>{{ formatBytes(selectedBytes) }}</strong>
			— within {{ PRICING_TIER_LIMITS_GB.free }} GB free
		</p>
	</Transition>
</template>

<style scoped>
.plan-notice-enter-active,
.plan-notice-leave-active {
	transition:
		opacity 0.32s cubic-bezier(0.22, 1, 0.36, 1),
		transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.plan-notice-enter-from,
.plan-notice-leave-to {
	opacity: 0;
	transform: translateY(4px);
}

.paid-notice {
	flex-shrink: 0;
	display: grid;
	grid-template-columns: var(--free-zone, 35%) minmax(0, 1fr);
	align-items: stretch;
	min-height: 2.15rem;
	margin: 0;
	padding: 0;
	border-radius: var(--radius-pill);
	border: 1px solid color-mix(in srgb, var(--fg) 10%, transparent);
	background: color-mix(in srgb, var(--surface) 55%, transparent);
	backdrop-filter: blur(10px);
	-webkit-backdrop-filter: blur(10px);
	box-shadow: 0 1px 0 rgba(255, 255, 255, 0.65) inset;
	overflow: hidden;
	transition: grid-template-columns 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.paid-zone {
	display: flex;
	align-items: center;
	min-width: 0;
	transition: background-color 0.35s ease;
}

.paid-zone-free {
	justify-content: center;
	padding: 0.4rem 0.5rem;
	background: color-mix(in srgb, var(--fg) 6%, transparent);
	border-right: 1px dashed color-mix(in srgb, var(--fg) 20%, transparent);
}

.paid-zone-over {
	flex: 1;
	justify-content: space-between;
	gap: 0.4rem 0.55rem;
	padding: 0.4rem 0.65rem 0.4rem 0.55rem;
	background: color-mix(in srgb, #8aad82 12%, transparent);
}

.paid-label {
	flex-shrink: 0;
	padding: 0.18rem 0.55rem;
	border-radius: var(--radius-pill);
	border: 1px solid color-mix(in srgb, var(--fg) 14%, transparent);
	background: color-mix(in srgb, var(--fg) 6%, transparent);
	color: var(--fg);
	font-size: 0.62rem;
	font-weight: 700;
	letter-spacing: 0.02em;
	white-space: nowrap;
}

.paid-copy {
	min-width: 0;
	flex: 1;
	font-size: 0.72rem;
	line-height: 1.35;
	color: var(--muted);
	transition: opacity 0.25s ease;
}

.paid-copy strong {
	color: color-mix(in srgb, var(--fg) 88%, transparent);
	font-weight: 700;
}

.paid-stripe {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	opacity: 0.55;
}

.free-notice {
	flex-shrink: 0;
	margin: 0;
	padding: 0.4rem 0.8rem;
	border-radius: var(--radius-pill);
	border: 1px solid color-mix(in srgb, #8aad82 28%, transparent);
	background: color-mix(in srgb, #8aad82 10%, transparent);
	font-size: 0.72rem;
	line-height: 1.35;
	color: color-mix(in srgb, var(--fg) 75%, transparent);
	backdrop-filter: blur(10px);
	-webkit-backdrop-filter: blur(10px);
	box-shadow: 0 1px 0 rgba(255, 255, 255, 0.5) inset;
}

.free-notice strong {
	color: var(--fg);
	font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
	.paid-notice,
	.paid-zone,
	.paid-copy,
	.plan-notice-enter-active,
	.plan-notice-leave-active {
		transition: none;
	}

	.plan-notice-enter-from,
	.plan-notice-leave-to {
		transform: none;
	}
}
</style>
