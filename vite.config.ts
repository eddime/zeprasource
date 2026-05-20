import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
	plugins: [vue(), tailwindcss()],
	root: "src/mainview",
	resolve: {
		alias: {
			"@": resolve(__dirname, "src/mainview"),
			"@shared": resolve(__dirname, "src/shared"),
		},
	},
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		// Dedicated port — never use 5173 (often occupied by other projects)
		port: 5180,
		strictPort: true,
		host: "127.0.0.1",
		cors: true,
		headers: {
			"X-Zepra-Dev": "1",
		},
		hmr: {
			host: "localhost",
			port: 5180,
			protocol: "ws",
		},
	},
});
