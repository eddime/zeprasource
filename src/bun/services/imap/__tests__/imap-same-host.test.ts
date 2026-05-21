import { describe, expect, test } from "bun:test";
import { canUseServerSideCopy, isSameImapEndpoint } from "../imap-same-host";
import type { MailboxCredentials } from "../../../../shared/types";

function creds(overrides: Partial<MailboxCredentials>): MailboxCredentials {
	return {
		provider: "generic",
		email: "user@test.com",
		host: "mail.example.com",
		port: 993,
		secure: true,
		authMethod: "password",
		accessProtocol: "imap",
		password: "x",
		...overrides,
	};
}

describe("imap-same-host", () => {
	test("same endpoint different emails does not enable server COPY", () => {
		const source = creds({ email: "a@test.com", host: "mail.example.com" });
		const dest = creds({ email: "b@test.com", host: "mail.example.com" });
		expect(isSameImapEndpoint(source, dest)).toBe(true);
		expect(canUseServerSideCopy(source, dest, false)).toBe(false);
	});

	test("same endpoint and same email enables server COPY", () => {
		const source = creds({ email: "user@test.com", host: "mail.example.com" });
		const dest = creds({ email: "user@test.com", host: "mail.example.com" });
		expect(canUseServerSideCopy(source, dest, false)).toBe(true);
	});
});
