/**
 * Tier limits (GB). Logic: ≤10 Trot, ≤25 Gallop, >25 Stampede.
 * Stampede price is a decoy anchor — most revenue is Trot + Gallop.
 */
export const PRICING_TIER_LIMITS_GB = {
	free: 2,
	starter: 10,
	plus: 25,
	pro: 25,
} as const;

/** Charm pricing: under €10 / €15 / €35 barriers. */
export const PRICING_TIER_PRICES = {
	starter: "€9",
	plus: "€14",
	pro: "€32",
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

/** Static plans for marketing / pricing sheet (matches getPricingTier thresholds). */
export const PRICING_PLANS: Array<MigrationPricingTier & { sizeLabel: string }> = [
	{
		id: "free",
		name: "Foal",
		priceLabel: "€0",
		tagline: "First steps on the savanna",
		hint: "Up to 2 GB per migration",
		sizeLabel: `Up to ${PRICING_TIER_LIMITS_GB.free} GB`,
	},
	{
		id: "starter",
		name: "Trot",
		priceLabel: PRICING_TIER_PRICES.starter,
		tagline: "Everyday mailbox crossing",
		hint: "One-time · less than a coffee",
		sizeLabel: `Up to ${PRICING_TIER_LIMITS_GB.starter} GB`,
	},
	{
		id: "plus",
		name: "Gallop",
		priceLabel: PRICING_TIER_PRICES.plus,
		tagline: "Full herd of folders",
		hint: "One-time · best value per GB",
		sizeLabel: `Up to ${PRICING_TIER_LIMITS_GB.plus} GB`,
	},
	{
		id: "pro",
		name: "Stampede",
		priceLabel: PRICING_TIER_PRICES.pro,
		tagline: "The great migration",
		hint: "One-time · decade of mail",
		sizeLabel: `Over ${PRICING_TIER_LIMITS_GB.pro} GB`,
	},
];

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function requiresPaidPlan(totalBytes: number): boolean {
	return totalBytes > FREE_MIGRATION_LIMIT_BYTES;
}

/** Simple tier for display — payment integration can hook into tier.id later. */
export function getPricingTier(totalBytes: number): MigrationPricingTier {
	const gb = totalBytes / 1024 ** 3;
	const { free, starter, plus, pro } = PRICING_TIER_LIMITS_GB;
	const prices = PRICING_TIER_PRICES;

	if (gb <= free) {
		return {
			id: "free",
			name: "Foal",
			priceLabel: "€0",
			hint: `Up to ${free} GB per migration`,
		};
	}
	if (gb <= starter) {
		return {
			id: "starter",
			name: "Trot",
			priceLabel: prices.starter,
			tagline: "Everyday mailbox crossing",
			hint: "One-time migration license",
		};
	}
	if (gb <= plus) {
		return {
			id: "plus",
			name: "Gallop",
			priceLabel: prices.plus,
			tagline: "Full herd of folders",
			hint: "One-time migration license",
		};
	}
	return {
		id: "pro",
		name: "Stampede",
		priceLabel: prices.pro,
		tagline: "The great migration",
		hint: "Large mailbox · one-time license",
	};
}
