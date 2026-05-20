/**
 * Waits for the Zepra Vite dev server, then starts Electrobun with --watch
 * so Bun (main process) reloads on backend changes.
 */
const DEV_URL = "http://127.0.0.1:5180";
const DEV_HEADER = "x-zepra-dev";
const MAX_ATTEMPTS = 80;

async function waitForVite(): Promise<void> {
	for (let i = 0; i < MAX_ATTEMPTS; i++) {
		try {
			const response = await fetch(DEV_URL, { method: "HEAD" });
			if (response.ok && response.headers.get(DEV_HEADER) === "1") {
				console.log(`[dev] Vite ready at ${DEV_URL}`);
				return;
			}
		} catch {
			/* not ready */
		}
		await Bun.sleep(250);
	}
	console.error("[dev] Timed out waiting for Vite on port 5180. Is `vite` running?");
	process.exit(1);
}

await waitForVite();

const proc = Bun.spawn(["electrobun", "dev", "--watch"], {
	cwd: process.cwd(),
	stdout: "inherit",
	stderr: "inherit",
	stdin: "inherit",
});

process.exit(await proc.exited);
