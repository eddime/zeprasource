import { ApplicationMenu } from "electrobun/bun";

/** Native Edit menu roles — required on macOS for ⌘C/V/A/X in the webview. */
export function setupApplicationMenu(): void {
	ApplicationMenu.setApplicationMenu([
		{
			label: "Zepra",
			submenu: [
				{ role: "about" },
				{ type: "divider" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "showAll" },
				{ type: "divider" },
				{ role: "quit" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "divider" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "Window",
			submenu: [{ role: "minimize" }, { role: "close" }],
		},
	]);
}
