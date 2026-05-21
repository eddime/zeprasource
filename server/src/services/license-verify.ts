import { hashFolderSelection } from "../shared/migration-payment";
import { billableGigabytes } from "../shared/pricing";
import { parseMigrationLaunchTicket } from "./launch-ticket";
import { getMigrationPricingCatalog } from "./pricing-catalog";

export type LicenseVerifyBody = {
	launchTicket: string;
	folderPaths: string[];
	totalBytes: number;
	messageCount: number;
};

export async function verifyMigrationLicense(body: LicenseVerifyBody): Promise<{
	valid: true;
	stripeSessionId: string;
	billableGb: number;
}> {
	const catalog = await getMigrationPricingCatalog();
	if (!catalog.configured) {
		throw new Error("Stripe pricing is not configured.");
	}

	const payload = parseMigrationLaunchTicket(body.launchTicket);
	const folderPathsHash = hashFolderSelection(body.folderPaths);

	if (
		payload.bytes !== body.totalBytes ||
		payload.msgs !== body.messageCount ||
		payload.fhash !== folderPathsHash
	) {
		throw new Error(
			"License does not match the current folder selection or mailbox size.",
		);
	}

	if (
		payload.gb !==
		billableGigabytes(body.totalBytes, catalog.freeLimitBytes)
	) {
		throw new Error("License does not match the billed gigabytes.");
	}

	return {
		valid: true,
		stripeSessionId: payload.sid,
		billableGb: payload.gb,
	};
}
