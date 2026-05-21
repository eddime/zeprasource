/**
 * Test streaming mail autodiscovery. Run: bun run scripts/test-autodiscover.ts
 */
import { discoverImapSettings } from "../src/bun/services/imap/imap-autodiscover";
import { connectMailbox } from "../src/bun/services/mail/mail-connection";
import { testImapConnection } from "../src/bun/services/imap/imap-client";
import { LOCAL_IMAP_SOURCE, LOCAL_IMAP_DEST } from "../src/shared/local-test-servers";

async function tryDiscover(label: string, email: string, password: string) {
	console.log(`\n--- ${label} (${email}) ---`);
	const t0 = performance.now();
	const discovered = await discoverImapSettings(email, { password });
	console.log(`Discovered in ${Math.round(performance.now() - t0)}ms:`, discovered);
}

async function tryConnect(label: string, email: string, password: string) {
	console.log(`\n--- connectMailbox: ${label} ---`);
	const t0 = performance.now();
	const result = await connectMailbox(email, password);
	console.log(
		`${Math.round(performance.now() - t0)}ms`,
		result.success ? "✅" : `❌ ${result.error}`,
		result.source,
		result.host,
	);
}

async function main() {
	console.log("1) Generic domain (streaming race, dummy password)");
	await tryDiscover("Autodiscover race", "user@wellemachen.com", "dummy");

	console.log("\n2) Local test — manual host");
	const local = await testImapConnection(LOCAL_IMAP_SOURCE);
	console.log(local.success ? "✅ Local source OK" : `❌ ${local.error}`);

	console.log("\n3) Local dest");
	const dest = await testImapConnection(LOCAL_IMAP_DEST);
	console.log(dest.success ? "✅ Local dest OK" : `❌ ${dest.error}`);

	console.log("\n4) connectMailbox API (dummy — expect auth or network fail)");
	try {
		await tryConnect("API shape", "user@example.com", "dummy");
	} catch (e) {
		console.log("Expected failure:", e instanceof Error ? e.message : e);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
