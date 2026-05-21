import type { MigrationPricingCatalog } from "./migration-pricing-catalog";

export type LifetimePricingCatalog = {
	configured: boolean;
	priceId: string | null;
	priceLabel: string;
	priceCents: number;
	currency: string;
	error?: string;
};

export type ZepraPricingCatalog = {
	perGb: MigrationPricingCatalog;
	lifetime: LifetimePricingCatalog;
};
