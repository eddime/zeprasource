import { describe, expect, test } from "bun:test";
import { toAppendPayload } from "../imap-append-batch";

describe("imap-append-batch", () => {
	test("toAppendPayload maps flags and date when preserving", () => {
		const payload = toAppendPayload(
			{
				uid: 1,
				source: Buffer.from("raw"),
				flags: new Set(["\\Seen"]),
				internalDate: new Date("2020-01-01T00:00:00Z"),
				messageId: "<a@test>",
			},
			true,
		);
		expect(payload.flags).toEqual(["\\Seen"]);
		expect(payload.internalDate?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
	});

	test("toAppendPayload omits flags when not preserving", () => {
		const payload = toAppendPayload(
			{
				uid: 2,
				source: Buffer.from("x"),
				flags: new Set(["\\Flagged"]),
			},
			false,
		);
		expect(payload.flags).toBeUndefined();
	});
});
