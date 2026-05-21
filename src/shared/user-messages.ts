/** End-user copy — never expose Stripe/env/technical errors in the UI. */

export function paymentErrorMessage(cause: unknown): string {
	const msg = cause instanceof Error ? cause.message.toLowerCase() : "";
	if (msg.includes("cancel")) {
		return "Payment was cancelled.";
	}
	if (msg.includes("timed out") || msg.includes("timeout")) {
		return "Payment took too long. Try again when you're ready.";
	}
	if (msg.includes("expired")) {
		return "Checkout expired. Start payment again.";
	}
	return "Payment couldn't be completed. Please try again.";
}
