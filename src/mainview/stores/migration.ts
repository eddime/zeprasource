import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import {
	migrationPercent,
	recordToProgress,
	splitSessionLists,
} from "../../shared/migration-sessions";
import type { MigrationProgress, MigrationRecord } from "../../shared/types";
import { getRpc, electroview } from "../lib/electrobun";
import { useMailboxesStore } from "./mailboxes";

export const useMigrationStore = defineStore("migration", () => {
	const focusedId = ref<string | null>(null);
	const progressById = shallowRef(new Map<string, MigrationProgress>());
	const history = ref<MigrationRecord[]>([]);
	const resumableIds = ref<string[]>([]);
	const running = ref(false);
	const resuming = ref(false);

	/** @deprecated use focusedId — kept for gradual migration of views */
	const activeId = computed({
		get: () => focusedId.value,
		set: (id: string | null) => {
			focusedId.value = id;
		},
	});

	const focusedProgress = computed(() => {
		const id = focusedId.value;
		if (!id) return null;
		return progressById.value.get(id) ?? null;
	});

	const progress = focusedProgress;

	const sessionLists = computed(() =>
		splitSessionLists(history.value, progressById.value),
	);

	const activeSessions = computed(() => sessionLists.value.active);
	const pastSessions = computed(() => sessionLists.value.past);
	const hasSessionCards = computed(
		() => activeSessions.value.length + pastSessions.value.length > 0,
	);
	const sessionsHydrated = ref(false);

	const isLiveMigration = computed(() => {
		const status = focusedProgress.value?.status;
		return (
			running.value ||
			resuming.value ||
			status === "running" ||
			status === "paused" ||
			status === "failed" ||
			status === "completed"
		);
	});

	const overallPercent = computed(() =>
		migrationPercent(focusedProgress.value ?? undefined),
	);

	function setProgress(snapshot: MigrationProgress) {
		const next = new Map(progressById.value);
		next.set(snapshot.migrationId, snapshot);
		progressById.value = next;
	}

	function syncFocusedFlags() {
		const id = focusedId.value;
		if (!id) {
			running.value = false;
			resuming.value = false;
			return;
		}
		const p = progressById.value.get(id);
		if (!p) {
			running.value = false;
			resuming.value = false;
			return;
		}
		running.value = p.status === "running";
		resuming.value = p.status === "paused" || p.status === "failed";
	}

	function listenForProgress() {
		electroview.rpc?.addMessageListener("migrationProgress", (payload) => {
			setProgress(payload);

			if (payload.migrationId === focusedId.value) {
				if (payload.status === "running") {
					running.value = true;
					resuming.value = false;
				}
				if (payload.status === "paused") {
					running.value = false;
					resuming.value = false;
				}
				if (payload.status === "completed" || payload.status === "failed") {
					running.value = false;
					resuming.value = false;
				}
			}

			if (payload.status === "completed" || payload.status === "failed") {
				void refreshHistory();
			}
		});
	}

	async function refreshHistory() {
		const rpc = getRpc();
		history.value = await rpc.request.listMigrations({ limit: 50 });
		resumableIds.value = await rpc.request.getResumableMigrations({});
	}

	async function hydrateActiveProgress() {
		const rpc = getRpc();
		const ids = history.value
			.filter((r) => r.status === "running" || r.status === "paused" || r.status === "failed")
			.map((r) => r.id);

		for (const id of ids) {
			if (progressById.value.has(id)) continue;
			const snapshot = await rpc.request.getMigrationProgress({ migrationId: id });
			if (snapshot) setProgress(snapshot);
		}
	}

	async function hydrateSessions() {
		try {
			await refreshHistory();
			await hydrateActiveProgress();
		} finally {
			sessionsHydrated.value = true;
		}
	}

	async function focusSession(migrationId: string) {
		const rpc = getRpc();
		focusedId.value = migrationId;

		const record = history.value.find((r) => r.id === migrationId);
		let snapshot = progressById.value.get(migrationId) ?? null;
		const stale =
			Boolean(record && snapshot && snapshot.status !== record.status);

		if (!snapshot || stale) {
			snapshot = await rpc.request.getMigrationProgress({ migrationId });
		}
		if (!snapshot && record) {
			snapshot = recordToProgress(record);
		}
		if (snapshot) setProgress(snapshot);

		const activeEngineIds = await rpc.request.getActiveMigrationIds({});
		if (snapshot?.status === "running" && activeEngineIds.includes(migrationId)) {
			running.value = true;
			resuming.value = false;
		} else if (snapshot?.status === "paused" || snapshot?.status === "failed") {
			running.value = false;
			resuming.value = true;
		} else if (
			snapshot?.status === "completed" ||
			snapshot?.status === "cancelled"
		) {
			running.value = false;
			resuming.value = false;
		} else {
			syncFocusedFlags();
		}
	}

	function resetFocused() {
		focusedId.value = null;
		running.value = false;
		resuming.value = false;
	}

	async function restoreSession(): Promise<boolean> {
		await hydrateSessions();
		const first = resumableIds.value[0];
		if (!first) return false;
		await focusSession(first);
		return true;
	}

	async function start(explicitResumeId?: string) {
		const rpc = getRpc();
		const resumeId =
			explicitResumeId ??
			(focusedProgress.value?.status === "running" ||
			focusedProgress.value?.status === "paused" ||
			focusedProgress.value?.status === "failed"
				? (focusedId.value ?? undefined)
				: undefined);

		running.value = true;
		resuming.value = Boolean(resumeId);
		try {
			const mailboxes = useMailboxesStore();
			const { migrationId } = resumeId
				? await rpc.request.startMigration({ resumeMigrationId: resumeId })
				: await rpc.request.startMigration({
						source: mailboxes.source,
						destination: mailboxes.destination,
						folderMappings: mailboxes.folderMappings.filter((f) => f.selected),
					});

			focusedId.value = migrationId;
			const snapshot = await rpc.request.getMigrationProgress({ migrationId });
			if (snapshot) setProgress(snapshot);
		} catch (error) {
			running.value = false;
			resuming.value = false;
			throw error;
		} finally {
			resuming.value = false;
		}
	}

	async function cancel() {
		if (!focusedId.value) return;
		const rpc = getRpc();
		await rpc.request.cancelMigration({ migrationId: focusedId.value });
		running.value = false;
		resuming.value = false;
	}

	async function pause() {
		if (!focusedId.value) return;
		const rpc = getRpc();
		await rpc.request.pauseMigration({ migrationId: focusedId.value });
		running.value = false;
	}

	return {
		focusedId,
		activeId,
		progressById,
		progress,
		focusedProgress,
		history,
		resumableIds,
		activeSessions,
		pastSessions,
		hasSessionCards,
		sessionsHydrated,
		running,
		resuming,
		isLiveMigration,
		overallPercent,
		listenForProgress,
		refreshHistory,
		hydrateSessions,
		focusSession,
		restoreSession,
		resetFocused,
		start,
		cancel,
		pause,
		/** @deprecated use resetFocused */
		reset: resetFocused,
	};
});
