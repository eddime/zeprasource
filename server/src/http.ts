import { getApiKey } from "./config";

const JSON_HEADERS = {
	"Content-Type": "application/json; charset=utf-8",
} as const;

export function jsonResponse(
	body: unknown,
	status = 200,
	extraHeaders?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...JSON_HEADERS, ...extraHeaders },
	});
}

export function errorResponse(message: string, status = 400): Response {
	return jsonResponse({ error: message }, status);
}

export async function readJsonBody<T>(req: Request): Promise<T> {
	const text = await req.text();
	if (!text.trim()) {
		throw new Error("Request body is required.");
	}
	return JSON.parse(text) as T;
}

export function requireApiKey(req: Request): Response | null {
	const expected = getApiKey();
	if (!expected) return null;

	const provided = req.headers.get("x-zepra-api-key");
	if (provided !== expected) {
		return errorResponse("Unauthorized", 401);
	}
	return null;
}

export function corsPreflight(req: Request): Response | null {
	if (req.method !== "OPTIONS") return null;
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers":
				"Content-Type, X-Zepra-Api-Key, Stripe-Signature",
			"Access-Control-Max-Age": "86400",
		},
	});
}

export function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", "*");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
