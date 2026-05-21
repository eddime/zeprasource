import { describe, expect, test } from "bun:test";
import { serverSupportsMultiAppend } from "../imap-multiappend";

describe("imap-multiappend", () => {
	test("serverSupportsMultiAppend reads capability map", () => {
		const withCap = {
			capabilities: new Map([["MULTIAPPEND", true]]),
		};
		const without = {
			capabilities: new Map<string, boolean>(),
		};
		expect(serverSupportsMultiAppend(withCap as never)).toBe(true);
		expect(serverSupportsMultiAppend(without as never)).toBe(false);
	});
});
