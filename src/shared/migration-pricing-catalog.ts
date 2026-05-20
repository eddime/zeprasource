import type { MigrationPricingTier } from "./pricing";

export type MigrationPriceLabels = {
	free: string;
	starter: string;
	plus: string;
	pro: string;
};

export type MigrationPricingPlan = MigrationPricingTier & { sizeLabel: string };

export type MigrationPricingCatalog = {
	configured: boolean;
	priceLabels: MigrationPriceLabels;
	plans: MigrationPricingPlan[];
};
