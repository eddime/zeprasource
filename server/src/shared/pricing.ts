import type { PaidMigrationTierId } from "./stripe-checkout";

export const PRICING_TIER_LIMITS_GB = {
	free: 2,
	starter: 10,
	plus: 25,
	pro: 25,
} as const;

export const FREE_MIGRATION_LIMIT_BYTES = PRICING_TIER_LIMITS_GB.free * 1024 ** 3;

export function getPricingTier(totalBytes: number): { id: string } {
	const gb = totalBytes / 1024 ** 3;
	const { free, starter, plus } = PRICING_TIER_LIMITS_GB;

	if (gb <= free) return { id: "free" };
	if (gb <= starter) return { id: "starter" };
	if (gb <= plus) return { id: "plus" };
	return { id: "pro" };
}

export function assertTierMatchesEstimate(
	tierId: PaidMigrationTierId,
	totalBytes: number,
): void {
	const expected = getPricingTier(totalBytes);
	if (expected.id !== tierId) {
		throw new Error(
			`Pricing tier mismatch (expected ${expected.id}, got ${tierId}).`,
		);
	}
}
