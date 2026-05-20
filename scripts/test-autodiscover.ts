/**
 * Test IMAP autodiscovery + connect. Run: bun run scripts/test-autodiscover.ts
 */
import { discoverImapSettings } from "../src/bun/services/imap/imap-autodiscover";
import { testImapConnection } from "../src/bun/services/imap/imap-client";
import { LOCAL_IMAP_SOURCE, LOCAL_IMAP_DEST } from "../src/shared/local-test-servers";

async function tryDiscover(label: string, email: string, password: string) {
	console.log(`\n--- ${label} (${email}) ---`);
	const discovered = await discoverImapSettings(email, { password });
	console.log("Discovered:", discovered);

	const result = await testImapConnection({
		provider: discovered.provider,
		email,
		host: discovered.host,
		port: discovered.port,
		secure: discovered.secure,
		authMethod: "password",
		password,
	});
	console.log(result.success ? "✅ Connected" : `❌ ${result.error}`);
	if (result.folders?.length) {
		console.log(`   Folders: ${result.folders.map((f) => f.path).join(", ")}`);
	}
}

async function main() {
	console.log("1) Known provider (Gmail domain → preset)");
	await tryDiscover("Gmail preset", "user@gmail.com", "dummy-not-connecting");

	console.log("\n2) Local test — manual host (autodiscover cannot guess 127.0.0.1)");
	const local = await testImapConnection(LOCAL_IMAP_SOURCE);
	console.log(local.success ? "✅ Local source OK" : `❌ ${local.error}`);

	console.log("\n3) Local dest");
	const dest = await testImapConnection(LOCAL_IMAP_DEST);
	console.log(dest.success ? "✅ Local dest OK" : `❌ ${dest.error}`);

	console.log("\n4) Shared hosting (banner verify, no password)");
	const hosting = await discoverImapSettings("user@wellemachen.com");
	console.log(hosting.verified ? "✅" : "⚠️", hosting);

	console.log("\n5) Local — manual host (127.0.0.1 not discoverable)");
	const creds = { ...LOCAL_IMAP_SOURCE, host: "127.0.0.1", port: 1143, secure: false };
	const fixed = await testImapConnection(creds);
	console.log(fixed.success ? "✅ Local after manual host" : `❌ ${fixed.error}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
