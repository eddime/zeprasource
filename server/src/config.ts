import { mkdirSync } from "node:fs";

export function getPort(): number {
	const raw = process.env.PORT?.trim();
	const port = raw ? Number(raw) : 8787;
	return Number.isFinite(port) && port > 0 ? port : 8787;
}

export function getStripeSecretKey(): string | undefined {
	const key = process.env.STRIPE_SECRET_KEY?.trim();
	return key && key.length > 0 ? key : undefined;
}

export function getStripeWebhookSecret(): string | undefined {
	const key = process.env.STRIPE_WEBHOOK_SECRET?.trim();
	return key && key.length > 0 ? key : undefined;
}

export function getLicenseSigningSecret(): string {
	const key = process.env.ZEPRA_LICENSE_SIGNING_SECRET?.trim();
	if (!key || key.length < 32) {
		throw new Error(
			"ZEPRA_LICENSE_SIGNING_SECRET must be set (min 32 characters).",
		);
	}
	return key;
}

export function getPublicServerUrl(): string | undefined {
	const url = process.env.ZEPRA_SERVER_PUBLIC_URL?.trim();
	if (!url) return undefined;
	return url.replace(/\/$/, "");
}

export function getPaymentReturnScheme(): string {
	return process.env.ZEPRA_PAYMENT_RETURN_SCHEME?.trim() || "zepra";
}

export function paymentReturnBase(): string {
	return `${getPaymentReturnScheme()}://payment`;
}

export function getApiKey(): string | undefined {
	const key = process.env.ZEPRA_API_KEY?.trim();
	return key && key.length > 0 ? key : undefined;
}

export function isStripeConfigured(): boolean {
	return Boolean(getStripeSecretKey());
}

export function getDataDirectory(): string {
	const raw = process.env.ZEPRA_DATA_DIR?.trim();
	const dir = raw && raw.length > 0 ? raw : `${process.cwd()}/data`;
	mkdirSync(dir, { recursive: true });
	return dir;
}
