import type { MigrationPricingCatalog } from "./migration-pricing-catalog";

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

export function formatPriceLabel(cents: number, currency: string): string {
	return formatMoney(cents, currency);
}

export function billableGigabytes(
	totalBytes: number,
	freeLimitBytes: number,
): number {
	const over = Math.max(0, totalBytes - freeLimitBytes);
	if (over === 0) return 0;
	return Math.ceil(over / 1024 ** 3);
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
): { id: "free" | "paid"; billableGb: number } {
	if (!catalog.configured) {
		throw new Error("Stripe pricing is not configured.");
	}
	const billableGb = billableGigabytes(totalBytes, catalog.freeLimitBytes);
	if (billableGb === 0) return { id: "free", billableGb: 0 };
	return { id: "paid", billableGb };
}

/** @deprecated */
export function getPricingTier(
	totalBytes: number,
	catalog: MigrationPricingCatalog,
): { id: string } {
	return getMigrationPricingQuote(totalBytes, catalog);
}
