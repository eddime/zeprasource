import { getPort, getPublicServerUrl, isStripeConfigured } from "./config";
import { handleRequest } from "./router";

const port = getPort();
const publicUrl = getPublicServerUrl();

Bun.serve({
	hostname: "0.0.0.0",
	port,
	fetch: handleRequest,
});

console.log(`zepra-server listening on http://0.0.0.0:${port}`);
if (publicUrl) {
	console.log(`Public URL: ${publicUrl}`);
	console.log(`Stripe webhook: ${publicUrl}/v1/webhooks/stripe`);
}
console.log(`Stripe configured: ${isStripeConfigured()}`);
