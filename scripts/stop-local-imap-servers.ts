import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const pidFile = join(root, ".test-fixtures/imap-pids.json");
const composeFile = join(root, "docker-compose.test-imap.yml");

if (existsSync(pidFile)) {
	try {
		const { pids } = JSON.parse(readFileSync(pidFile, "utf8")) as { pids: number[] };
		for (const pid of pids) {
			try {
				process.kill(pid);
			} catch {
				/* already stopped */
			}
		}
		unlinkSync(pidFile);
		console.log("Stopped Java GreenMail processes.");
	} catch {
		/* ignore */
	}
}

spawnSync("docker", ["compose", "-f", composeFile, "down"], {
	cwd: root,
	stdio: "inherit",
});
