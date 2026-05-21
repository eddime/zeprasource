import type { MigrationPricingCatalog } from "./migration-pricing-catalog";
import { formatPricePerGbLabel } from "./pricing";

export const STRIPE_METADATA_FREE_MIGRATION_GB = "free_migration_gb";

export function parseFreeMigrationGb(
	metadata: Record<string, string> | null | undefined,
): number | null {
	const raw = metadata?.[STRIPE_METADATA_FREE_MIGRATION_GB];
	if (raw == null || raw === "") return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return null;
	return n;
}

export function freeLimitBytesFromGb(gb: number): number {
	return gb * 1024 ** 3;
}

export type StripePriceSnapshot = {
	id: string;
	unit_amount: number;
	currency: string;
	metadata: Record<string, string> | null;
	productMetadata?: Record<string, string> | null;
};

export function migrationCatalogFromStripePrice(
	price: StripePriceSnapshot,
): MigrationPricingCatalog {
	const freeGb =
		parseFreeMigrationGb(price.metadata) ??
		parseFreeMigrationGb(price.productMetadata);
	if (freeGb == null) {
		return migrationCatalogUnavailable("missing_free_migration_gb_metadata");
	}
	const freeLimitBytes = freeLimitBytesFromGb(freeGb);
	return {
		configured: true,
		priceId: price.id,
		freeLimitGb: freeGb,
		freeLimitBytes,
		pricePerGbCents: price.unit_amount,
		pricePerGbLabel: formatPricePerGbLabel(price.unit_amount, price.currency),
		currency: price.currency,
	};
}

export function migrationCatalogUnavailable(
	error: string,
	currency = "usd",
): MigrationPricingCatalog {
	return {
		configured: false,
		priceId: null,
		freeLimitGb: 0,
		freeLimitBytes: 0,
		pricePerGbCents: 0,
		pricePerGbLabel: "",
		currency,
		error,
	};
}
