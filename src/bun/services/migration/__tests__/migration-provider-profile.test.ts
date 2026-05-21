import { describe, expect, test } from "bun:test";
import { resolveMigrationProviderProfile } from "../migration-provider-profile";
import type { MailboxCredentials } from "../../../../shared/types";

function creds(
	overrides: Partial<MailboxCredentials> & Pick<MailboxCredentials, "provider" | "host">,
): MailboxCredentials {
	return {
		email: "u@test.com",
		port: 993,
		secure: true,
		authMethod: "password",
		accessProtocol: "imap",
		password: "x",
		...overrides,
	};
}

describe("migration-provider-profile", () => {
	test("hostname does not change profile — only provider type", () => {
		const dreamhost = resolveMigrationProviderProfile(
			creds({ provider: "generic", host: "imap.dreamhost.com" }),
			creds({ provider: "gmail", host: "imap.gmail.com" }),
			false,
		);
		const otherHost = resolveMigrationProviderProfile(
			creds({ provider: "generic", host: "mail.wellemachen.com" }),
			creds({ provider: "gmail", host: "imap.gmail.com" }),
			false,
		);
		expect(dreamhost.id).toBe(otherHost.id);
		expect(dreamhost.fetchBatchSize).toBe(otherHost.fetchBatchSize);
	});

	test("gmail+outlook merges conservative batch sizes", () => {
		const profile = resolveMigrationProviderProfile(
			creds({ provider: "gmail", host: "imap.gmail.com" }),
			creds({ provider: "outlook", host: "outlook.office365.com" }),
			false,
		);
		expect(profile.id).toBe("gmail+outlook");
		expect(profile.fetchBatchSize).toBe(35);
		expect(profile.maxFetchBatchSize).toBe(70);
	});
});
