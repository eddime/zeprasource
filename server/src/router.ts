import Stripe from "stripe";
import { getStripeWebhookSecret, isStripeConfigured } from "./config";
import {
	corsPreflight,
	errorResponse,
	jsonResponse,
	readJsonBody,
	requireApiKey,
	withCors,
} from "./http";
import {
	createCheckoutSession,
	getCheckoutStatus,
	handleCheckoutCompletedWebhook,
} from "./services/checkout";
import { verifyMigrationLicense } from "./services/license-verify";
import type { MigrationCheckoutCreateBody } from "./shared/stripe-checkout";
import { getMigrationPricingCatalog } from "./services/pricing-catalog";
import type { LicenseVerifyBody } from "./services/license-verify";
import { createStripeClient } from "./stripe-client";

export async function handleRequest(req: Request): Promise<Response> {
	const preflight = corsPreflight(req);
	if (preflight) return preflight;

	const url = new URL(req.url);
	const path = url.pathname.replace(/\/$/, "") || "/";

	try {
		if (req.method === "GET" && path === "/health") {
			return withCors(
				jsonResponse({
					ok: true,
					stripe: isStripeConfigured(),
					service: "zepra-server",
				}),
			);
		}

		if (req.method === "GET" && path === "/v1/pricing/catalog") {
			const catalog = await getMigrationPricingCatalog();
			return withCors(jsonResponse(catalog));
		}

		if (req.method === "POST" && path === "/v1/webhooks/stripe") {
			return withCors(await handleStripeWebhook(req));
		}

		const authError = requireApiKey(req);
		if (authError) return withCors(authError);

		if (req.method === "POST" && path === "/v1/checkout/sessions") {
			if (!isStripeConfigured()) {
				return withCors(
					errorResponse("Stripe is not configured on the server.", 503),
				);
			}
			const body = await readJsonBody<MigrationCheckoutCreateBody>(req);
			const session = await createCheckoutSession(body);
			return withCors(jsonResponse(session, 201));
		}

		if (req.method === "GET" && path.startsWith("/v1/checkout/sessions/")) {
			if (!isStripeConfigured()) {
				return withCors(
					errorResponse("Stripe is not configured on the server.", 503),
				);
			}
			const sessionId = decodeURIComponent(
				path.slice("/v1/checkout/sessions/".length),
			);
			if (!sessionId.startsWith("cs_")) {
				return withCors(errorResponse("Invalid checkout session id."));
			}
			const status = await getCheckoutStatus(sessionId);
			return withCors(jsonResponse(status));
		}

		if (req.method === "POST" && path === "/v1/licenses/verify") {
			const body = await readJsonBody<LicenseVerifyBody>(req);
			const result = verifyMigrationLicense(body);
			return withCors(jsonResponse(result));
		}

		return withCors(errorResponse("Not found", 404));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Internal server error";
		const status = message.includes("not configured") ? 503 : 400;
		return withCors(errorResponse(message, status));
	}
}

async function handleStripeWebhook(req: Request): Promise<Response> {
	const webhookSecret = getStripeWebhookSecret();
	if (!webhookSecret) {
		return errorResponse("STRIPE_WEBHOOK_SECRET is not configured.", 503);
	}

	const signature = req.headers.get("stripe-signature");
	if (!signature) {
		return errorResponse("Missing Stripe-Signature header.", 400);
	}

	const rawBody = await req.text();
	let event: Stripe.Event;

	try {
		const stripe = createStripeClient();
		event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
	} catch {
		return errorResponse("Invalid webhook signature.", 400);
	}

	if (event.type === "checkout.session.completed") {
		const session = event.data.object as Stripe.Checkout.Session;
		await handleCheckoutCompletedWebhook(session);
	}

	return jsonResponse({ received: true });
}
