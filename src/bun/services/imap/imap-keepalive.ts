import type { ImapFlow } from "imapflow";
import { logger } from "../../utils/logger";

/** Periodic NOOP so long migrations do not die on idle disconnect. */
export function startImapKeepalive(
	getClient: () => ImapFlow | null | undefined,
	intervalMs = 5 * 60_000,
): () => void {
	const timer = setInterval(() => {
		void (async () => {
			const client = getClient();
			if (!client?.authenticated) return;
			try {
				await client.noop();
			} catch (error) {
				logger.debug(
					"imap",
					`Keepalive NOOP failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		})();
	}, intervalMs);
	return () => clearInterval(timer);
}
