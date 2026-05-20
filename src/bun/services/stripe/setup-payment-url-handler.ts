import Electrobun from "electrobun/bun";
import { handlePaymentReturnUrl } from "./migration-checkout";

const electrobunEventEmitter = Electrobun.events;

export function setupPaymentUrlHandler(): void {
	electrobunEventEmitter.on(
		"open-url",
		(event: { data?: { url?: string } }) => {
			const url = event.data?.url;
			if (!url) return;
			handlePaymentReturnUrl(url);
		},
	);
}
