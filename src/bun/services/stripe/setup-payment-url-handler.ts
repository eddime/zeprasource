import Electrobun from "electrobun/bun";
import { handleLifetimePaymentReturnUrl } from "./lifetime-checkout";
import { handlePaymentReturnUrl } from "./migration-checkout";

const electrobunEventEmitter = Electrobun.events;

export function setupPaymentUrlHandler(): void {
	electrobunEventEmitter.on(
		"open-url",
		(event: { data?: { url?: string } }) => {
			const url = event.data?.url;
			if (!url) return;
			handleLifetimePaymentReturnUrl(url);
			handlePaymentReturnUrl(url);
		},
	);
}
