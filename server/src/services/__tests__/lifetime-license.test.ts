import { describe, expect, test, beforeEach } from "bun:test";
import {
	issueLifetimeLicense,
	parseLifetimeLicense,
} from "../lifetime-license";
import { clearLifetimeStore, storeLifetimeEntitlement } from "../lifetime-store";

process.env.ZEPRA_LICENSE_SIGNING_SECRET =
	"test-signing-secret-min-32-chars-long!!";

describe("lifetime license", () => {
	beforeEach(() => {
		clearLifetimeStore();
	});

	test("issues and parses a signed license", () => {
		const license = issueLifetimeLicense("cs_test_lifetime_123");
		expect(license.startsWith("zepra_lt.")).toBe(true);

		const payload = parseLifetimeLicense(license);
		expect(payload.kind).toBe("lifetime");
		expect(payload.sid).toBe("cs_test_lifetime_123");
		expect(payload.jti.length).toBeGreaterThan(8);
	});

	test("rejects tampered signature", () => {
		const license = issueLifetimeLicense("cs_test_lifetime_123");
		const tampered = `${license}x`;
		expect(() => parseLifetimeLicense(tampered)).toThrow();
	});

	test("store links jti to session", () => {
		const license = issueLifetimeLicense("cs_store_1");
		const payload = parseLifetimeLicense(license);
		storeLifetimeEntitlement({
			stripeSessionId: payload.sid,
			license,
			jti: payload.jti,
		});
		expect(parseLifetimeLicense(license).sid).toBe("cs_store_1");
	});
});
