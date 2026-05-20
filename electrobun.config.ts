import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Zepra",
		identifier: "dev.zepra.app",
		version: "0.1.0",
		urlSchemes: ["zepra"],
	},
	build: {
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
