export type MigrationPricingCatalog = {
	configured: boolean;
	priceId: string | null;
	freeLimitGb: number;
	freeLimitBytes: number;
	pricePerGbCents: number;
	pricePerGbLabel: string;
	currency: string;
	error?: string;
};
