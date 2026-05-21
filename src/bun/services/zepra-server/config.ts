export function getZepraServerUrl(): string | undefined {
	const url = process.env.ZEPRA_SERVER_URL?.trim();
	if (!url) return undefined;
	return url.replace(/\/$/, "");
}

export function getZepraApiKey(): string | undefined {
	const key = process.env.ZEPRA_API_KEY?.trim();
	return key && key.length > 0 ? key : undefined;
}

export function isZepraServerConfigured(): boolean {
	return Boolean(getZepraServerUrl());
}
