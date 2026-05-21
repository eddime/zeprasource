export type LifetimePricingCatalog = {
	configured: boolean;
	priceId: string | null;
	priceLabel: string;
	priceCents: number;
	currency: string;
	error?: string;
};

export type ZepraPricingCatalog = {
	perGb: import("./migration-pricing-catalog").MigrationPricingCatalog;
	lifetime: LifetimePricingCatalog;
};
