/**
 * Linear migration pricing: free tier + per billed gigabyte.
 * Unit price and free limit come from Stripe — see migration-pricing-catalog.
 */
import type { MigrationPricingCatalog } from "./migration-pricing-catalog";

export interface MigrationPricingQuote {
	id: "free" | "paid";
	billableGb: number;
	priceLabel: string;
	/** e.g. "8 GB × $0.75" */
	formulaLabel: string | null;
	hint: string;
}

export function billableGigabytes(
	totalBytes: number,
	freeLimitBytes: number,
): number {
	const over = Math.max(0, totalBytes - freeLimitBytes);
	if (over === 0) return 0;
	return Math.ceil(over / 1024 ** 3);
}

export function migrationChargeCents(
	totalBytes: number,
	pricePerGbCents: number,
	freeLimitBytes: number,
): number {
	return billableGigabytes(totalBytes, freeLimitBytes) * pricePerGbCents;
}

export function formatMoney(cents: number, currency: string): string {
	const value = cents / 100;
	const code = currency.toLowerCase();
	const hasFraction = cents % 100 !== 0;
	const digits = hasFraction ? 2 : 0;
	if (code === "eur") {
		const num = value.toLocaleString("de-DE", {
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		});
		return `€${num}`;
	}
	if (code === "usd") {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: digits,
			maximumFractionDigits: 2,
		}).format(value);
	}
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: code.toUpperCase(),
		minimumFractionDigits: digits,
		maximumFractionDigits: 2,
	}).format(value);
}

export function formatPricePerGbLabel(cents: number, currency: string): string {
	return `${formatMoney(cents, currency)} / GB`;
}

/** One-time price label (e.g. Lifetime). */
export function formatPriceLabel(cents: number, currency: string): string {
	return formatMoney(cents, currency);
}

export function requiresPaidPlan(
	totalBytes: number,
	freeLimitBytes: number,
): boolean {
	return totalBytes > freeLimitBytes;
}

export function assertBillableGbMatchesEstimate(
	billableGb: number,
	totalBytes: number,
	freeLimitBytes: number,
): void {
	const expected = billableGigabytes(totalBytes, freeLimitBytes);
	if (billableGb !== expected) {
		throw new Error(
			`Billable GB mismatch (expected ${expected}, got ${billableGb}).`,
		);
	}
}

export function getMigrationPricingQuote(
	totalBytes: number,
	catalog: MigrationPricingCatalog,
): MigrationPricingQuote {
	if (!catalog.configured) {
		throw new Error("Stripe pricing is not configured.");
	}

	const billableGb = billableGigabytes(totalBytes, catalog.freeLimitBytes);

	if (billableGb === 0) {
		return {
			id: "free",
			billableGb: 0,
			priceLabel: formatMoney(0, catalog.currency),
			formulaLabel: null,
			hint: `Up to ${catalog.freeLimitGb} GB per migration`,
		};
	}

	const cents = billableGb * catalog.pricePerGbCents;
	const unitLabel = formatMoney(catalog.pricePerGbCents, catalog.currency);

	return {
		id: "paid",
		billableGb,
		priceLabel: formatMoney(cents, catalog.currency),
		formulaLabel: `${billableGb} GB × ${unitLabel}`,
		hint: "One-time payment for this migration run",
	};
}

/** @deprecated Use getMigrationPricingQuote */
export function getPricingTier(
	totalBytes: number,
	catalog: MigrationPricingCatalog,
): MigrationPricingQuote {
	return getMigrationPricingQuote(totalBytes, catalog);
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Overage above the free tier — always in GB for pricing math readability. */
export function formatOverageGb(bytes: number): string {
	const gb = bytes / 1024 ** 3;
	if (gb < 0.01) return `${gb.toFixed(3)} GB`;
	if (gb < 10) return `${gb.toFixed(2)} GB`;
	return `${gb.toFixed(1)} GB`;
}

export type BillableBreakdown = {
	totalLabel: string;
	overLabel: string;
	billableGb: number;
	unitPriceLabel: string;
	priceLabel: string;
	/** e.g. "+0.94 GB → 1 GB × $0.75" */
	chargeLine: string;
};

/** Readable split: total size, bytes over free tier, billed GB (rounded). */
export function getBillableBreakdown(
	totalBytes: number,
	catalog: MigrationPricingCatalog,
): BillableBreakdown | null {
	const quote = getMigrationPricingQuote(totalBytes, catalog);
	if (quote.id === "free") return null;

	const unitLabel = formatMoney(catalog.pricePerGbCents, catalog.currency);
	const overBytes = Math.max(0, totalBytes - catalog.freeLimitBytes);
	const overLabel = formatOverageGb(overBytes);
	const overGb = overBytes / 1024 ** 3;
	const billedPart = `${quote.billableGb} GB × ${unitLabel}`;
	const roundsUp = quote.billableGb > overGb + 0.005;

	const chargeLine = roundsUp
		? `+${overLabel} → ${billedPart}`
		: `+${quote.billableGb} GB × ${unitLabel}`;

	return {
		totalLabel: formatBytes(totalBytes),
		overLabel,
		billableGb: quote.billableGb,
		unitPriceLabel: unitLabel,
		priceLabel: quote.priceLabel,
		chargeLine,
	};
}

/** Example totals for the pricing sheet (fixed mailbox sizes). */
export function buildPricingExamples(
	catalog: MigrationPricingCatalog,
): Array<{ sizeGb: number; priceLabel: string; detail: string }> {
	const sizes = [10, 25, 50];
	return sizes.map((sizeGb) => {
		const bytes = sizeGb * 1024 ** 3;
		const quote = getMigrationPricingQuote(bytes, catalog);
		return {
			sizeGb,
			priceLabel: quote.priceLabel,
			detail:
				quote.formulaLabel ??
				`Up to ${catalog.freeLimitGb} GB free`,
		};
	});
}
