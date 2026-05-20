import type { MailboxCredentials } from "../../../shared/types";
import {
	evaluateDestinationQuota,
	type DestinationQuotaCheck,
} from "../../../shared/destination-quota";
import { createImapClient, safeCloseImapClient } from "./imap-client";
import { formatImapError, normalizeMailboxCredentials } from "./credentials";

export async function checkDestinationQuota(
	destination: MailboxCredentials,
	required: { bytes: number; messages: number },
): Promise<DestinationQuotaCheck> {
	const credentials = normalizeMailboxCredentials(destination);
	const client = await createImapClient(credentials, "test");

	try {
		await client.connect();
		const quota = await client.getQuota("INBOX");
		if (quota === false) {
			return evaluateDestinationQuota({}, required);
		}

		return evaluateDestinationQuota(
			{
				storage: quota.storage,
				messages: quota.messages,
			},
			required,
		);
	} catch (error) {
		const message = formatImapError(error, credentials);
		throw new Error(message);
	} finally {
		await safeCloseImapClient(client);
	}
}
