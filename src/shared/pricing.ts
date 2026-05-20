/**
 * Tier limits (GB). Logic: ≤10 Trot, ≤25 Gallop, >25 Stampede.
 * Prices are loaded from Stripe at runtime — see migration-pricing-catalog.
 */
import type {
	MigrationPriceLabels,
	MigrationPricingPlan,
} from "./migration-pricing-catalog";

export const PRICING_TIER_LIMITS_GB = {
	free: 2,
	starter: 10,
	plus: 25,
	pro: 25,
} as const;

/** Used when Stripe is unavailable (offline / missing key). */
export const FALLBACK_MIGRATION_PRICE_LABELS: MigrationPriceLabels = {
	free: "€0",
	starter: "€9",
	plus: "€14",
	pro: "€29",
};

/** @deprecated Use FALLBACK_MIGRATION_PRICE_LABELS */
export const PRICING_TIER_PRICES = {
	starter: FALLBACK_MIGRATION_PRICE_LABELS.starter,
	plus: FALLBACK_MIGRATION_PRICE_LABELS.plus,
	pro: FALLBACK_MIGRATION_PRICE_LABELS.pro,
} as const;

export const FREE_MIGRATION_LIMIT_BYTES = PRICING_TIER_LIMITS_GB.free * 1024 ** 3;

export interface MigrationPricingTier {
	id: string;
	name: string;
	priceLabel: string;
	hint: string;
	/** Shown on pricing sheet — conversion-focused copy */
	tagline?: string;
}

const TIER_PLAN_META: Array<
	Omit<MigrationPricingPlan, "priceLabel"> & { id: keyof MigrationPriceLabels }
> = [
	{
		id: "free",
		name: "Foal",
		tagline: "First steps on the savanna",
		hint: "Up to 2 GB per migration",
		sizeLabel: `Up to ${PRICING_TIER_LIMITS_GB.free} GB`,
	},
	{
		id: "starter",
		name: "Trot",
		tagline: "Everyday mailbox crossing",
		hint: "One-time · less than a coffee",
		sizeLabel: `Up to ${PRICING_TIER_LIMITS_GB.starter} GB`,
	},
	{
		id: "plus",
		name: "Gallop",
		tagline: "Full herd of folders",
		hint: "One-time · best value per GB",
		sizeLabel: `Up to ${PRICING_TIER_LIMITS_GB.plus} GB`,
	},
	{
		id: "pro",
		name: "Stampede",
		tagline: "The great migration",
		hint: "One-time · decade of mail",
		sizeLabel: `Over ${PRICING_TIER_LIMITS_GB.pro} GB`,
	},
];

export function buildPricingPlans(
	priceLabels: MigrationPriceLabels = FALLBACK_MIGRATION_PRICE_LABELS,
): MigrationPricingPlan[] {
	return TIER_PLAN_META.map((plan) => ({
		...plan,
		priceLabel: priceLabels[plan.id],
	}));
}

/** @deprecated Prefer buildPricingPlans() with live Stripe labels from the pricing store. */
export const PRICING_PLANS = buildPricingPlans();

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function requiresPaidPlan(totalBytes: number): boolean {
	return totalBytes > FREE_MIGRATION_LIMIT_BYTES;
}

export function getPricingTier(
	totalBytes: number,
	priceLabels: MigrationPriceLabels = FALLBACK_MIGRATION_PRICE_LABELS,
): MigrationPricingTier {
	const gb = totalBytes / 1024 ** 3;
	const { free, starter, plus, pro } = PRICING_TIER_LIMITS_GB;

	if (gb <= free) {
		return {
			id: "free",
			name: "Foal",
			priceLabel: priceLabels.free,
			hint: `Up to ${free} GB per migration`,
		};
	}
	if (gb <= starter) {
		return {
			id: "starter",
			name: "Trot",
			priceLabel: priceLabels.starter,
			tagline: "Everyday mailbox crossing",
			hint: "One-time migration license",
		};
	}
	if (gb <= plus) {
		return {
			id: "plus",
			name: "Gallop",
			priceLabel: priceLabels.plus,
			tagline: "Full herd of folders",
			hint: "One-time migration license",
		};
	}
	return {
		id: "pro",
		name: "Stampede",
		priceLabel: priceLabels.pro,
		tagline: "The great migration",
		hint: "Large mailbox · one-time license",
	};
}
