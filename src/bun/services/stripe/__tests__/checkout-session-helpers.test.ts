import { describe, expect, test } from "bun:test";
import type Stripe from "stripe";
import {
	quantityForPriceId,
	sessionHasLifetimeLineItem,
} from "../checkout-session-helpers";

function line(
	priceId: string,
	quantity: number,
): Stripe.LineItem {
	return {
		price: { id: priceId } as Stripe.Price,
		quantity,
	} as Stripe.LineItem;
}

describe("checkout-session-helpers", () => {
	test("sums quantity for matching price id across line items", () => {
		const items = [
			line("price_gb", 8),
			line("price_lt", 1),
		];
		expect(quantityForPriceId(items, "price_gb")).toBe(8);
		expect(quantityForPriceId(items, "price_lt")).toBe(1);
		expect(sessionHasLifetimeLineItem(items, "price_lt")).toBe(true);
		expect(sessionHasLifetimeLineItem(items, "price_missing")).toBe(false);
	});
});
