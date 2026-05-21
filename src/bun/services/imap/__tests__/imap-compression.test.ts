import { describe, expect, test } from "bun:test";
import {
	isLocalImapHost,
	preferImapCompression,
	shouldRetryImapWithoutCompression,
} from "../imap-compression";

describe("imap-compression", () => {
	test("detects local dev hosts", () => {
		expect(isLocalImapHost("127.0.0.1")).toBe(true);
		expect(isLocalImapHost("localhost")).toBe(true);
		expect(isLocalImapHost("imap.dreamhost.com")).toBe(false);
	});

	test("prefers compression only for remote migration mode", () => {
		expect(preferImapCompression("imap.gmail.com", "migration")).toBe(true);
		expect(preferImapCompression("127.0.0.1", "migration")).toBe(false);
		expect(preferImapCompression("imap.gmail.com", "test")).toBe(false);
	});

	test("classifies zlib/COMPRESS failures as retry-without-compression", () => {
		expect(shouldRetryImapWithoutCompression(new Error("COMPRESS failed"))).toBe(true);
		expect(shouldRetryImapWithoutCompression(new Error("invalid stored block lengths"))).toBe(
			true,
		);
		expect(shouldRetryImapWithoutCompression(new Error("LOGIN failed"))).toBe(false);
	});
});
