import Electrobun, { Electroview } from "electrobun/view";
import type { MailPortRPC } from "../../bun/rpc/schema";

const rpc = Electroview.defineRPC<MailPortRPC>({
	maxRequestTime: 300_000,
	handlers: {
		requests: {},
		messages: {},
	},
});

export const electroview = new Electrobun.Electroview({ rpc });

export function getRpc() {
	if (!electroview.rpc) {
		throw new Error("Electrobun RPC is not available");
	}
	return electroview.rpc;
}
