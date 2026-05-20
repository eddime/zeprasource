import { hashFolderSelection } from "../shared/migration-payment";
import { getPricingTier } from "../shared/pricing";
import { parseMigrationLaunchTicket } from "./launch-ticket";

export type LicenseVerifyBody = {
	launchTicket: string;
	folderPaths: string[];
	totalBytes: number;
	messageCount: number;
};

export function verifyMigrationLicense(body: LicenseVerifyBody): {
	valid: true;
	stripeSessionId: string;
	tierId: string;
} {
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

	if (getPricingTier(body.totalBytes).id !== payload.tier) {
		throw new Error("License tier does not match the current mailbox size.");
	}

	return {
		valid: true,
		stripeSessionId: payload.sid,
		tierId: payload.tier,
	};
}
