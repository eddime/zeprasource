import Electrobun, { BrowserWindow, Utils } from "electrobun/bun";
import { BrowserWindowMap } from "../../node_modules/electrobun/dist/api/bun/core/BrowserWindow";
import { getMigrationById } from "./db/migration-repository";
import { getResumableMigrations } from "./services/migration/migration-engine";
import { pauseAllMigrationsForShutdown } from "./services/migration/migration-orchestrator";

const electrobunEventEmitter = Electrobun.events;

let forceQuit = false;

function isMigrationActive(): boolean {
	for (const id of getResumableMigrations()) {
		const row = getMigrationById(id);
		if (
			row?.status === "running" ||
			row?.status === "paused" ||
			row?.status === "failed"
		) {
			return true;
		}
	}
	return false;
}

function promptQuitDuringMigration(): boolean {
	const pending = Utils.showMessageBox({
		type: "warning",
		title: "Migration läuft noch",
		message: "Migration läuft noch — wirklich beenden?",
		detail:
			"Minimiere Zepra (gelber Button), dann läuft die Migration weiter. Beim Schließen wird pausiert und beim nächsten Öffnen automatisch fortgesetzt.",
		buttons: ["Weiter migrieren", "App beenden"],
		defaultId: 0,
		cancelId: 0,
	});

	const result = Bun.peek(pending) as { response: number } | undefined;
	const response = result?.response ?? 0;

	return response === 1;
}

function restoreMainWindow(mainWindow: BrowserWindow) {
	BrowserWindowMap[mainWindow.id] = mainWindow;
	mainWindow.show();
}

export function setupMigrationCloseGuard(mainWindow: BrowserWindow) {
	electrobunEventEmitter.prependListener(
		"before-quit",
		(event: {
			response?: { allow: boolean };
		}) => {
			if (forceQuit || !isMigrationActive()) return;

			if (!promptQuitDuringMigration()) {
				event.response = { allow: false };
				restoreMainWindow(mainWindow);
				return;
			}

			forceQuit = true;
			pauseAllMigrationsForShutdown();
		},
	);

	// After Electrobun's built-in close handler (map cleanup + quit attempt).
	electrobunEventEmitter.on(
		"close",
		(event: { data: { id: number } }) => {
			if (event.data.id !== mainWindow.id || forceQuit || !isMigrationActive()) {
				return;
			}
			restoreMainWindow(mainWindow);
		},
	);
}
