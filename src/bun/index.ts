import { BrowserWindow, Updater } from "electrobun/bun";
import { ZEPRA_WINDOW_HEIGHT, ZEPRA_WINDOW_WIDTH } from "../shared/window";

// Load optional secrets from mailport/.env
try {
	const envPath = `${import.meta.dir}/../../.env`;
	const envFile = Bun.file(envPath);
	if (await envFile.exists()) {
		const text = await envFile.text();
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
			if (!process.env[key]) process.env[key] = value;
		}
	}
} catch {
	/* optional .env */
}
import { getDatabase, getDatabasePath } from "./db/database";
import { setupMigrationCloseGuard } from "./migration-close-guard";
import { setupApplicationMenu } from "./setup-application-menu";
import { getProgressEmitter, mailportRpc, setProgressBridge } from "./rpc/handlers";
import { resumeInterruptedMigrations } from "./services/migration/migration-orchestrator";
import { logger } from "./utils/logger";

const DEV_SERVER_PORT = 5180;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const ZEPRA_DEV_HEADER = "x-zepra-dev";

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			const response = await fetch(DEV_SERVER_URL, { method: "HEAD" });
			if (
				response.ok &&
				response.headers.get(ZEPRA_DEV_HEADER) === "1"
			) {
				logger.info("main", `HMR: ${DEV_SERVER_URL}`);
				return DEV_SERVER_URL;
			}
			logger.info(
				"main",
				`Port ${DEV_SERVER_PORT} in use by another app — using bundled Zepra UI`,
			);
		} catch {
			logger.info("main", "Zepra Vite not running — using bundled views");
		}
	}
	return "views://mainview/index.html";
}

getDatabase();
setupApplicationMenu();

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "Zepra",
	url,
	rpc: mailportRpc,
	frame: {
		width: ZEPRA_WINDOW_WIDTH,
		height: ZEPRA_WINDOW_HEIGHT,
		x: 120,
		y: 80,
	},
	styleMask: {
		Resizable: false,
		Miniaturizable: true,
	},
});

setProgressBridge(mailportRpc);
setupMigrationCloseGuard(mainWindow);

const progressEmitter = getProgressEmitter();
if (progressEmitter) {
	resumeInterruptedMigrations(progressEmitter);
}

logger.info("main", "Zepra started");
logger.info("main", `Local data: ${getDatabasePath()}`);
