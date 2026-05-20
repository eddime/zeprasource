import { ImapFlow } from "imapflow";
import {
	LOCAL_IMAP_DEST,
	LOCAL_IMAP_SOURCE,
} from "../../../shared/local-test-servers";
import { testImapConnection } from "./imap-client";

export async function checkLocalTestServers(): Promise<{
	source: boolean;
	destination: boolean;
}> {
	const [sourceResult, destResult] = await Promise.all([
		testImapConnection(LOCAL_IMAP_SOURCE),
		testImapConnection(LOCAL_IMAP_DEST),
	]);
	return {
		source: sourceResult.success,
		destination: destResult.success,
	};
}

export async function seedLocalTestSourceInbox(): Promise<{ ok: boolean; error?: string }> {
	const check = await testImapConnection(LOCAL_IMAP_SOURCE);
	if (!check.success) {
		return {
			ok: false,
			error: "Source server not reachable on 127.0.0.1:1143. Start Docker test servers first.",
		};
	}

	const client = new ImapFlow({
		host: LOCAL_IMAP_SOURCE.host,
		port: LOCAL_IMAP_SOURCE.port,
		secure: LOCAL_IMAP_SOURCE.secure,
		auth: {
			user: LOCAL_IMAP_SOURCE.username ?? LOCAL_IMAP_SOURCE.email,
			pass: LOCAL_IMAP_SOURCE.password ?? "",
		},
		logger: false,
	});

	try {
		await client.connect();
		const raw = [
			"From: source@test",
			"To: source@test",
			`Subject: Zepra test ${new Date().toISOString()}`,
			`Message-ID: <zepra-seed-${Date.now()}@local.test>`,
			"",
			"Test message for local generic migration.",
		].join("\r\n");
		await client.append("INBOX", raw);
		await client.logout();
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Failed to append test message",
		};
	} finally {
		try {
			await client.close();
		} catch {
			/* closed */
		}
	}
}
