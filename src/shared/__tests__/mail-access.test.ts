import { describe, expect, test } from "bun:test";
import {
	isPop3Access,
	POP3_INBOX_PATH,
	resolveMailAccessProtocol,
} from "../mail-access";

describe("mail-access", () => {
	test("defaults unknown protocol to IMAP", () => {
		expect(resolveMailAccessProtocol(undefined)).toBe("imap");
		expect(isPop3Access(undefined)).toBe(false);
	});

	test("recognizes POP3", () => {
		expect(resolveMailAccessProtocol("pop3")).toBe("pop3");
		expect(isPop3Access("pop3")).toBe(true);
	});

	test("exposes POP inbox path", () => {
		expect(POP3_INBOX_PATH).toBe("INBOX");
	});
});
