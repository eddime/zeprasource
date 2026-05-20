/**
 * Start two local IMAP test servers (Docker preferred, else GreenMail JAR + Java).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const composeFile = join(root, "docker-compose.test-imap.yml");
const jarPath = join(root, ".test-fixtures/greenmail-standalone.jar");
const pidFile = join(root, ".test-fixtures/imap-pids.json");

const JAR_URL =
	"https://repo1.maven.org/maven2/com/icegreen/greenmail-standalone/2.1.8/greenmail-standalone-2.1.8.jar";

function hasCommand(cmd: string): boolean {
	return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function resolveJava(): string | null {
	const brewJava =
		existsSync("/usr/local/opt/openjdk/bin/java")
			? "/usr/local/opt/openjdk"
			: existsSync("/opt/homebrew/opt/openjdk/bin/java")
				? "/opt/homebrew/opt/openjdk"
				: null;
	if (brewJava && !process.env.JAVA_HOME) {
		process.env.JAVA_HOME = brewJava;
		process.env.PATH = `${brewJava}/bin:${process.env.PATH ?? ""}`;
	}

	const candidates = [
		process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin/java") : null,
		"/usr/local/opt/openjdk/bin/java",
		"/opt/homebrew/opt/openjdk/bin/java",
		hasCommand("java") ? "java" : null,
	].filter((p): p is string => Boolean(p));

	for (const java of candidates) {
		if (java !== "java" && !existsSync(java)) continue;
		const probe = spawnSync(java, ["-version"], { encoding: "utf8" });
		const out = `${probe.stderr ?? ""}${probe.stdout ?? ""}`;
		if (probe.status === 0 && !/Unable to locate a Java Runtime/i.test(out)) {
			return java;
		}
	}
	return null;
}

async function ensureJar(): Promise<void> {
	mkdirSync(join(root, ".test-fixtures"), { recursive: true });
	if (existsSync(jarPath)) return;
	console.log("Downloading GreenMail…");
	const res = await fetch(JAR_URL);
	if (!res.ok) throw new Error(`Download failed: ${res.status}`);
	await Bun.write(jarPath, res);
}

function startDocker(): boolean {
	if (!hasCommand("docker")) return false;
	console.log("Starting IMAP servers with Docker…");
	const result = spawnSync(
		"docker",
		["compose", "-f", composeFile, "up", "-d"],
		{ cwd: root, stdio: "inherit" },
	);
	return result.status === 0;
}

function startJavaServers(): boolean {
	const java = resolveJava();
	if (!java) return false;

	const ports = [1143, 2143];
	const pids: number[] = [];
	for (const port of ports) {
		const child = spawn(
			java,
			[
				"-Dgreenmail.imap.hostname=127.0.0.1",
				`-Dgreenmail.imap.port=${port}`,
				"-Dgreenmail.auth.disabled",
				"-jar",
				jarPath,
			],
			{ cwd: root, detached: true, stdio: "ignore" },
		);
		child.unref();
		if (child.pid) pids.push(child.pid);
		console.log(`GreenMail on 127.0.0.1:${port} (pid ${child.pid})`);
	}
	writeFileSync(pidFile, JSON.stringify({ pids, mode: "java" }, null, 2));
	// GreenMail needs a moment to bind ports
	spawnSync("sleep", ["2"]);
	return pids.length === 2;
}

function printHelp(): void {
	console.error(`
Could not start local IMAP test servers.

Option A — Docker (recommended):
  1. Install Docker Desktop: https://www.docker.com/products/docker-desktop/
  2. Run: bun run imap:up

Option B — Java:
  brew install openjdk
  export JAVA_HOME="$(brew --prefix openjdk)"
  bun run imap:up

Option C — No local servers (needs internet):
  In Zepra → "Use cloud test mailboxes" (no Docker)

Then in Zepra: Local test servers → Check → Use as From / To → Verify
`);
}

async function main() {
	if (startDocker()) {
		console.log("✅ Docker IMAP servers starting on 127.0.0.1:1143 and :2143");
		return;
	}

	await ensureJar().catch(() => {
		/* download optional */
	});

	if (existsSync(jarPath) && startJavaServers()) {
		console.log("✅ Java GreenMail on 127.0.0.1:1143 and :2143");
		return;
	}

	printHelp();
	process.exit(1);
}

main();
