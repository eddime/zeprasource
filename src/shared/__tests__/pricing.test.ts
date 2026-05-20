import { describe, expect, test } from "bun:test";
import {
	PRICING_TIER_LIMITS_GB,
	PRICING_TIER_PRICES,
	getPricingTier,
	requiresPaidPlan,
} from "../pricing";

const gb = (n: number) => n * 1024 ** 3;

describe("getPricingTier", () => {
	test("free up to 2 GB", () => {
		expect(getPricingTier(gb(2)).id).toBe("free");
		expect(getPricingTier(gb(2)).priceLabel).toBe("€0");
	});

	test("starter captures typical personal mailboxes (3–10 GB)", () => {
		expect(getPricingTier(gb(3)).id).toBe("starter");
		expect(getPricingTier(gb(8)).id).toBe("starter");
		expect(getPricingTier(gb(10)).id).toBe("starter");
		expect(getPricingTier(gb(10)).priceLabel).toBe(PRICING_TIER_PRICES.starter);
	});

	test("plus for large mailboxes up to 25 GB", () => {
		expect(getPricingTier(gb(11)).id).toBe("plus");
		expect(getPricingTier(gb(25)).id).toBe("plus");
		expect(getPricingTier(gb(25)).priceLabel).toBe(PRICING_TIER_PRICES.plus);
	});

	test("pro only above 25 GB", () => {
		expect(getPricingTier(gb(25.1)).id).toBe("pro");
		expect(getPricingTier(gb(80)).priceLabel).toBe(PRICING_TIER_PRICES.pro);
	});
});

describe("requiresPaidPlan", () => {
	test("paid above free limit", () => {
		expect(requiresPaidPlan(gb(PRICING_TIER_LIMITS_GB.free))).toBe(false);
		expect(requiresPaidPlan(gb(PRICING_TIER_LIMITS_GB.free) + 1)).toBe(true);
	});
});
