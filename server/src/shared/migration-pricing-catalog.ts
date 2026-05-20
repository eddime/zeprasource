export type MigrationPriceLabels = {
	free: string;
	starter: string;
	plus: string;
	pro: string;
};

export type MigrationPricingPlan = {
	id: string;
	name: string;
	priceLabel: string;
	hint: string;
	tagline?: string;
	sizeLabel: string;
};

export type MigrationPricingCatalog = {
	configured: boolean;
	priceLabels: MigrationPriceLabels;
	plans: MigrationPricingPlan[];
};

export const FALLBACK_MIGRATION_PRICE_LABELS: MigrationPriceLabels = {
	free: "€0",
	starter: "€9",
	plus: "€14",
	pro: "€32",
};

const PLANS: Array<Omit<MigrationPricingPlan, "priceLabel">> = [
	{
		id: "free",
		name: "Foal",
		tagline: "First steps on the savanna",
		hint: "Up to 2 GB per migration",
		sizeLabel: "Up to 2 GB",
	},
	{
		id: "starter",
		name: "Trot",
		tagline: "Everyday mailbox crossing",
		hint: "One-time · less than a coffee",
		sizeLabel: "Up to 10 GB",
	},
	{
		id: "plus",
		name: "Gallop",
		tagline: "Full herd of folders",
		hint: "One-time · best value per GB",
		sizeLabel: "Up to 25 GB",
	},
	{
		id: "pro",
		name: "Stampede",
		tagline: "The great migration",
		hint: "One-time · decade of mail",
		sizeLabel: "Over 25 GB",
	},
];

export function buildPricingPlans(
	priceLabels: MigrationPriceLabels = FALLBACK_MIGRATION_PRICE_LABELS,
): MigrationPricingPlan[] {
	return PLANS.map((plan) => ({
		...plan,
		priceLabel: priceLabels[plan.id as keyof MigrationPriceLabels],
	}));
}
