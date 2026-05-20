import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
	buildPricingPlans,
	FALLBACK_MIGRATION_PRICE_LABELS,
	getPricingTier,
} from "../../shared/pricing";
import type { MigrationPricingCatalog } from "../../shared/migration-pricing-catalog";
import { getRpc } from "../lib/electrobun";

export const usePricingStore = defineStore("pricing", () => {
	const catalog = ref<MigrationPricingCatalog | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);

	const priceLabels = computed(
		() => catalog.value?.priceLabels ?? FALLBACK_MIGRATION_PRICE_LABELS,
	);

	const plans = computed(
		() => catalog.value?.plans ?? buildPricingPlans(FALLBACK_MIGRATION_PRICE_LABELS),
	);

	const stripeLive = computed(() => catalog.value?.configured ?? false);

	function tierForBytes(totalBytes: number) {
		return getPricingTier(totalBytes, priceLabels.value);
	}

	async function ensureLoaded(force = false): Promise<void> {
		if (!force && (catalog.value || loading.value)) return;

		loading.value = true;
		error.value = null;
		try {
			catalog.value = await getRpc().request.getMigrationPricingCatalog({});
		} catch (err) {
			error.value =
				err instanceof Error ? err.message : "Could not load prices from Stripe";
			catalog.value = {
				configured: false,
				priceLabels: { ...FALLBACK_MIGRATION_PRICE_LABELS },
				plans: buildPricingPlans(FALLBACK_MIGRATION_PRICE_LABELS),
			};
		} finally {
			loading.value = false;
		}
	}

	return {
		catalog,
		loading,
		error,
		priceLabels,
		plans,
		stripeLive,
		tierForBytes,
		ensureLoaded,
	};
});
