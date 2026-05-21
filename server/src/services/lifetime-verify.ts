import { createStripeClient, isStripeConfigured } from "../stripe-client";
import {
	getLifetimeByJti,
	getLifetimeBySessionId,
} from "./lifetime-store";
import { parseLifetimeLicense } from "./lifetime-license";
import { verifyLifetimeStripeSession } from "./lifetime-checkout";

export type LifetimeVerifyBody = {
	lifetimeLicense: string;
};

export type LifetimeVerifyResponse = {
	valid: true;
	stripeSessionId: string;
};

export async function verifyLifetimeLicense(
	body: LifetimeVerifyBody,
): Promise<LifetimeVerifyResponse> {
	const payload = parseLifetimeLicense(body.lifetimeLicense);

	const stored =
		getLifetimeByJti(payload.jti) ??
		getLifetimeBySessionId(payload.sid);
	if (!stored || stored.license !== body.lifetimeLicense) {
		throw new Error("Lifetime license is not registered.");
	}

	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured on the server.");
	}

	const stripe = createStripeClient();
	const session = await stripe.checkout.sessions.retrieve(payload.sid);
	await verifyLifetimeStripeSession(session);

	return {
		valid: true,
		stripeSessionId: payload.sid,
	};
}
