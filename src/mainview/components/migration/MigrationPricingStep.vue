<script setup lang="ts">
import { computed } from "vue";
import type { MigrationSizeEstimate } from "../../../shared/types";
import { formatBytes, getPricingTier } from "../../../shared/pricing";
import ZebraMascot from "../zebra/ZebraMascot.vue";
import AppButton from "../ui/AppButton.vue";

const props = defineProps<{
	estimate: MigrationSizeEstimate;
	loading?: boolean;
}>();

defineEmits<{
	back: [];
	continue: [];
}>();

const tier = computed(() => getPricingTier(props.estimate.totalBytes));
const overLimitGb = computed(
	() => props.estimate.totalBytes / (1024 ** 3) - props.estimate.freeLimitBytes / (1024 ** 3),
);
</script>

<template>
	<div class="pricing">
		<ZebraMascot state="idle" :size="100" />
		<h2>Your mailbox is larger than {{ formatBytes(estimate.freeLimitBytes) }}</h2>
		<p class="lead">
			We measured <strong>{{ formatBytes(estimate.totalBytes) }}</strong> across
			{{ estimate.messageCount }} messages in {{ estimate.folders.length }} folders.
			Choose a plan to continue — migration still runs locally on your computer.
		</p>

		<div class="size-card">
			<div class="row">
				<span>Total size</span>
				<strong>{{ formatBytes(estimate.totalBytes) }}</strong>
			</div>
			<div class="row muted">
				<span>Free limit</span>
				<span>{{ formatBytes(estimate.freeLimitBytes) }}</span>
			</div>
			<div class="row over">
				<span>Above limit</span>
				<span>+{{ overLimitGb.toFixed(2) }} GB</span>
			</div>
		</div>

		<article class="plan featured">
			<p class="plan-tag">Recommended</p>
			<h3>{{ tier.name }}</h3>
			<p class="price">{{ tier.priceLabel }}</p>
			<p class="plan-hint">{{ tier.hint }}</p>
			<ul>
				<li>Unlimited folders in this migration</li>
				<li>Local-first — nothing uploaded to Zepra</li>
				<li>Resume if interrupted</li>
			</ul>
		</article>

		<p class="note">
			Payment is not wired yet — this screen previews pricing. Tap continue to start
			the migration anyway during beta.
		</p>

		<div class="actions">
			<AppButton variant="secondary" block @click="$emit('back')">Back</AppButton>
			<AppButton block :loading="loading" @click="$emit('continue')">
				Continue with {{ tier.name }} — {{ tier.priceLabel }}
			</AppButton>
		</div>
	</div>
</template>

<style scoped>
.pricing {
	height: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.5rem;
	text-align: center;
	max-width: 420px;
	margin: 0 auto;
	padding: 0.25rem 0;
	overflow: hidden;
	box-sizing: border-box;
}
h2 {
	margin: 0;
	font-size: 1.25rem;
	font-weight: 700;
	letter-spacing: -0.02em;
}
.lead {
	margin: 0;
	font-size: 0.85rem;
	color: var(--muted);
	line-height: 1.45;
}
.lead strong {
	color: var(--fg);
}
.size-card {
	width: 100%;
	border: 1px solid var(--border);
	border-radius: var(--radius-card);
	padding: 0.75rem 0.9rem;
	background: var(--surface);
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}
.row {
	display: flex;
	justify-content: space-between;
	font-size: 0.8rem;
}
.row.muted {
	color: var(--muted);
}
.row.over {
	color: var(--fg);
	font-weight: 600;
}
.plan {
	width: 100%;
	text-align: left;
	border: 1px solid var(--border);
	border-radius: var(--radius-card);
	padding: 1rem;
	background: var(--bg);
}
.plan.featured {
	border-color: var(--fg);
	box-shadow: var(--shadow-soft);
}
.plan-tag {
	margin: 0 0 0.35rem;
	font-size: 0.65rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--muted);
}
.plan h3 {
	margin: 0;
	font-size: 1rem;
}
.price {
	margin: 0.25rem 0 0;
	font-size: 1.75rem;
	font-weight: 700;
	letter-spacing: -0.03em;
}
.plan-hint {
	margin: 0.15rem 0 0.6rem;
	font-size: 0.75rem;
	color: var(--muted);
}
.plan ul {
	margin: 0;
	padding-left: 1.1rem;
	font-size: 0.78rem;
	color: var(--muted);
	line-height: 1.45;
}
.note {
	margin: 0;
	font-size: 0.7rem;
	color: var(--muted-light);
	line-height: 1.35;
}
.actions {
	width: 100%;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
</style>
