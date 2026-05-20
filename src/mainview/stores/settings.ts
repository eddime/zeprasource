import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AppSettings } from "../../shared/types";
import { DEFAULT_SETTINGS } from "../../shared/types";
import { getRpc } from "../lib/electrobun";

export const useSettingsStore = defineStore("settings", () => {
	const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
	const loaded = ref(false);

	async function load() {
		const rpc = getRpc();
		settings.value = await rpc.request.getSettings({});
		loaded.value = true;
	}

	async function save(partial: Partial<AppSettings>) {
		const rpc = getRpc();
		settings.value = { ...settings.value, ...partial };
		settings.value = await rpc.request.saveSettings({ settings: settings.value });
	}

	const theme = computed(() => settings.value.theme);

	return {
		settings,
		theme,
		loaded,
		load,
		save,
	};
});
