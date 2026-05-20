import { describe, expect, test } from "bun:test";
import {
	FALLBACK_MIGRATION_PRICE_LABELS,
	PRICING_TIER_LIMITS_GB,
	buildPricingPlans,
	getPricingTier,
	requiresPaidPlan,
} from "../pricing";

const gb = (n: number) => n * 1024 ** 3;

const customLabels = {
	free: "€0",
	starter: "€8",
	plus: "€13",
	pro: "€30",
};

describe("getPricingTier", () => {
	test("free up to 2 GB", () => {
		expect(getPricingTier(gb(2)).id).toBe("free");
		expect(getPricingTier(gb(2)).priceLabel).toBe("€0");
	});

	test("starter captures typical personal mailboxes (3–10 GB)", () => {
		expect(getPricingTier(gb(3)).id).toBe("starter");
		expect(getPricingTier(gb(8)).id).toBe("starter");
		expect(getPricingTier(gb(10)).id).toBe("starter");
		expect(getPricingTier(gb(10), customLabels).priceLabel).toBe("€8");
	});

	test("plus for large mailboxes up to 25 GB", () => {
		expect(getPricingTier(gb(11)).id).toBe("plus");
		expect(getPricingTier(gb(25)).id).toBe("plus");
		expect(getPricingTier(gb(25), customLabels).priceLabel).toBe("€13");
	});

	test("pro only above 25 GB", () => {
		expect(getPricingTier(gb(25.1)).id).toBe("pro");
		expect(getPricingTier(gb(80), customLabels).priceLabel).toBe("€30");
	});
});

describe("buildPricingPlans", () => {
	test("uses dynamic labels when provided", () => {
		const plans = buildPricingPlans(customLabels);
		expect(plans.find((p) => p.id === "plus")?.priceLabel).toBe("€13");
	});

	test("falls back to static labels", () => {
		const plans = buildPricingPlans();
		expect(plans.find((p) => p.id === "starter")?.priceLabel).toBe(
			FALLBACK_MIGRATION_PRICE_LABELS.starter,
		);
	});
});

describe("requiresPaidPlan", () => {
	test("paid above free limit", () => {
		expect(requiresPaidPlan(gb(PRICING_TIER_LIMITS_GB.free))).toBe(false);
		expect(requiresPaidPlan(gb(PRICING_TIER_LIMITS_GB.free) + 1)).toBe(true);
	});
});
