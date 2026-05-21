import type { ZepraPricingCatalog } from "../shared/lifetime-pricing-catalog";
import { getMigrationPricingCatalog } from "./pricing-catalog";
import { getLifetimePricingCatalog } from "./lifetime-pricing-catalog";

export async function getZepraPricingCatalog(): Promise<ZepraPricingCatalog> {
	const [perGb, lifetime] = await Promise.all([
		getMigrationPricingCatalog(),
		getLifetimePricingCatalog(),
	]);
	return { perGb, lifetime };
}
