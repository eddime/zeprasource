import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { buildPricingExamples, getMigrationPricingQuote } from "../../shared/pricing";
import type { MigrationPricingCatalog } from "../../shared/migration-pricing-catalog";
import type {
	LifetimePricingCatalog,
	ZepraPricingCatalog,
} from "../../shared/lifetime-pricing-catalog";
import { getRpc } from "../lib/electrobun";

const emptyLifetime = (): LifetimePricingCatalog => ({
	configured: false,
	priceId: null,
	priceLabel: "",
	priceCents: 0,
	currency: "eur",
});

export const usePricingStore = defineStore("pricing", () => {
	const catalog = ref<ZepraPricingCatalog | null>(null);
	const loading = ref(false);
	const lifetimeLoading = ref(false);
	const hasLifetime = ref(false);
	const lifetimeCheckoutReady = ref(false);
	const entitlementLoaded = ref(false);

	const perGbCatalog = computed(() => catalog.value?.perGb ?? null);
	const lifetimeCatalog = computed(() => catalog.value?.lifetime ?? emptyLifetime());

	const isReady = computed(() => perGbCatalog.value?.configured === true);

	const activeCatalog = computed(() =>
		isReady.value ? perGbCatalog.value! : null,
	);

	/** Lifetime price visible in UI (Stripe catalog, same as per-GB). */
	const lifetimeReady = computed(
		() => lifetimeCatalog.value.configured || hasLifetime.value,
	);

	const examples = computed(() =>
		activeCatalog.value ? buildPricingExamples(activeCatalog.value) : [],
	);

	const stripeLive = computed(() => isReady.value);

	function quoteForBytes(totalBytes: number) {
		const c = activeCatalog.value;
		if (!c) {
			throw new Error("Pricing unavailable");
		}
		return getMigrationPricingQuote(totalBytes, c);
	}

	function tierForBytes(totalBytes: number) {
		return quoteForBytes(totalBytes);
	}

	async function ensureLoaded(force = false): Promise<void> {
		if (!force && (perGbCatalog.value?.configured || loading.value)) return;

		loading.value = true;
		try {
			const loaded = await getRpc().request.getZepraPricingCatalog({});
			catalog.value = {
				perGb: loaded.perGb.configured ? loaded.perGb : loaded.perGb,
				lifetime: loaded.lifetime,
			};
			if (!loaded.perGb.configured && import.meta.env.DEV) {
				console.warn("[pricing] Stripe per-GB catalog not ready:", loaded.perGb.error);
			}
		} catch (err) {
			catalog.value = null;
			if (import.meta.env.DEV) {
				console.warn("[pricing] catalog fetch failed:", err);
			}
		} finally {
			loading.value = false;
		}
	}

	async function refreshEntitlement(force = false): Promise<void> {
		if (!force && entitlementLoaded.value) return;
		try {
			const status = await getRpc().request.getEntitlementStatus({});
			hasLifetime.value = status.lifetime;
			lifetimeCheckoutReady.value = status.lifetimeCheckoutAvailable;
		} catch {
			hasLifetime.value = false;
			lifetimeCheckoutReady.value = false;
		} finally {
			entitlementLoaded.value = true;
		}
	}

	async function purchaseLifetime(): Promise<void> {
		lifetimeLoading.value = true;
		try {
			const checkout = await getRpc().request.createLifetimeCheckout({});
			if (!checkout.configured) {
				throw new Error("checkout_unavailable");
			}
			const opened = await getRpc().request.openMigrationCheckout({
				checkoutUrl: checkout.checkoutUrl,
				sessionId: checkout.sessionId,
			});
			if (!opened.opened) {
				throw new Error("browser_open_failed");
			}
			const payment = await getRpc().request.waitForLifetimeCheckout({
				sessionId: checkout.sessionId,
			});
			if (!payment.paid) {
				throw new Error(payment.error ?? "payment_failed");
			}
			hasLifetime.value = true;
			entitlementLoaded.value = true;
		} finally {
			lifetimeLoading.value = false;
		}
	}

	return {
		catalog,
		loading,
		lifetimeLoading,
		hasLifetime,
		lifetimeCheckoutReady,
		entitlementLoaded,
		perGbCatalog,
		lifetimeCatalog,
		isReady,
		lifetimeReady,
		activeCatalog,
		examples,
		stripeLive,
		quoteForBytes,
		tierForBytes,
		ensureLoaded,
		refreshEntitlement,
		purchaseLifetime,
	};
});
