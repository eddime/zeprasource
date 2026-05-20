<script setup lang="ts">
import { onMounted } from "vue";
import HomeView from "./views/HomeView.vue";
import { useMigrationStore } from "./stores/migration";
import { useMailboxesStore } from "./stores/mailboxes";
import { useSettingsStore } from "./stores/settings";

const migration = useMigrationStore();
const mailboxes = useMailboxesStore();
const settings = useSettingsStore();

onMounted(async () => {
	document.documentElement.classList.remove("dark");
	migration.listenForProgress();
	await settings.load();
	await mailboxes.loadSavedProfiles();
	await migration.hydrateSessions();
});
</script>

<template>
	<HomeView />
</template>
