import { describe, expect, test } from "bun:test";
import type { MigrationPricingCatalog } from "../migration-pricing-catalog";
import {
	billableGigabytes,
	buildPricingExamples,
	getBillableBreakdown,
	getMigrationPricingQuote,
	migrationChargeCents,
	requiresPaidPlan,
} from "../pricing";

const gb = (n: number) => n * 1024 ** 3;
const FREE_GB = 2;
const FREE_BYTES = FREE_GB * 1024 ** 3;

const testCatalog: MigrationPricingCatalog = {
	configured: true,
	priceId: "price_test",
	freeLimitGb: FREE_GB,
	freeLimitBytes: FREE_BYTES,
	pricePerGbCents: 75,
	pricePerGbLabel: "$0.75 / GB",
	currency: "usd",
};

describe("billableGigabytes", () => {
	test("free up to 2 GB", () => {
		expect(billableGigabytes(gb(2), FREE_BYTES)).toBe(0);
		expect(billableGigabytes(gb(1.5), FREE_BYTES)).toBe(0);
	});

	test("ceil partial gigabytes over free limit", () => {
		expect(billableGigabytes(gb(2) + 1, FREE_BYTES)).toBe(1);
		expect(billableGigabytes(gb(3), FREE_BYTES)).toBe(1);
		expect(billableGigabytes(gb(10), FREE_BYTES)).toBe(8);
		expect(billableGigabytes(gb(25), FREE_BYTES)).toBe(23);
	});
});

describe("getMigrationPricingQuote", () => {
	test("free tier quote", () => {
		const quote = getMigrationPricingQuote(gb(2), testCatalog);
		expect(quote.id).toBe("free");
		expect(quote.priceLabel).toBe("$0");
		expect(quote.formulaLabel).toBeNull();
	});

	test("paid quote uses per-GB formula", () => {
		const quote = getMigrationPricingQuote(gb(10), testCatalog);
		expect(quote.id).toBe("paid");
		expect(quote.billableGb).toBe(8);
		expect(quote.formulaLabel).toBe("8 GB × $0.75");
		expect(quote.priceLabel).toBe("$6");
	});

	test("custom unit price from catalog", () => {
		const quote = getMigrationPricingQuote(gb(10), {
			...testCatalog,
			pricePerGbCents: 100,
			pricePerGbLabel: "$1.00 / GB",
		});
		expect(quote.priceLabel).toBe("$8");
	});
});

describe("migrationChargeCents", () => {
	test("linear total", () => {
		expect(
			migrationChargeCents(gb(10), testCatalog.pricePerGbCents, FREE_BYTES),
		).toBe(8 * 75);
	});
});

describe("buildPricingExamples", () => {
	test("includes sample mailbox sizes", () => {
		const examples = buildPricingExamples(testCatalog);
		expect(examples.map((e) => e.sizeGb)).toEqual([10, 25, 50]);
	});
});

describe("requiresPaidPlan", () => {
	test("paid above free limit", () => {
		expect(requiresPaidPlan(gb(FREE_GB), FREE_BYTES)).toBe(false);
		expect(requiresPaidPlan(gb(FREE_GB) + 1, FREE_BYTES)).toBe(true);
	});
});

describe("getBillableBreakdown", () => {
	test("shows overage before rounded billable GB", () => {
		const bytes = 2.94 * 1024 ** 3;
		const breakdown = getBillableBreakdown(bytes, testCatalog);
		expect(breakdown?.totalLabel).toBe("2.94 GB");
		expect(breakdown?.chargeLine).toBe("+0.94 GB → 1 GB × $0.75");
		expect(breakdown?.priceLabel).toBe("$0.75");
	});
});
