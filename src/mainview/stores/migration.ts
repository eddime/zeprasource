import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import {
	deriveMigrationUiState,
	isLiveUiPhase,
	isTerminalMigrationStatus,
	mergeMigrationProgress,
	type MigrationUiContext,
} from "../../shared/migration-ui-state";
import {
	migrationPercent,
	recordToProgress,
	splitSessionLists,
} from "../../shared/migration-sessions";
import type { MigrationProgress, MigrationRecord } from "../../shared/types";
import { getRpc, electroview } from "../lib/electrobun";
import { useMailboxesStore } from "./mailboxes";

const UI_CLOCK_MS = 1000;
const PROGRESS_POLL_MS = 3000;

export const useMigrationStore = defineStore("migration", () => {
	const focusedId = ref<string | null>(null);
	const progressById = shallowRef(new Map<string, MigrationProgress>());
	const history = ref<MigrationRecord[]>([]);
	const resumableIds = ref<string[]>([]);
	const engineActiveIds = ref<string[]>([]);
	const pendingAction = ref<MigrationUiContext["pendingAction"]>(null);
	const resumeError = ref<string | null>(null);
	const plannedDurationHint = ref<string | null>(null);
	const uiClock = ref(Date.now());

	let uiClockTimer: ReturnType<typeof setInterval> | null = null;
	let progressPollTimer: ReturnType<typeof setInterval> | null = null;

	const focusedProgress = computed(() => {
		const id = focusedId.value;
		return id ? (progressById.value.get(id) ?? null) : null;
	});

	const progress = focusedProgress;

	const uiContext = computed(
		(): MigrationUiContext => ({
			pendingAction: pendingAction.value,
			engineInMemory: focusedId.value
				? engineActiveIds.value.includes(focusedId.value)
				: false,
			plannedDurationHint: plannedDurationHint.value,
			resumeError: resumeError.value,
			nowMs: uiClock.value,
		}),
	);

	const ui = computed(() => deriveMigrationUiState(focusedProgress.value, uiContext.value));

	const sessionLists = computed(() =>
		splitSessionLists(history.value, progressById.value),
	);

	const activeSessions = computed(() => sessionLists.value.active);
	const pastSessions = computed(() => sessionLists.value.past);
	const hasSessionCards = computed(
		() => activeSessions.value.length + pastSessions.value.length > 0,
	);
	const sessionsHydrated = ref(false);
	const isLiveMigration = computed(() => ui.value.showHero);
	const overallPercent = computed(() => migrationPercent(focusedProgress.value ?? undefined));

	function stopLiveTimers() {
		if (uiClockTimer) clearInterval(uiClockTimer);
		if (progressPollTimer) clearInterval(progressPollTimer);
		uiClockTimer = null;
		progressPollTimer = null;
	}

	function applyProgress(incoming: MigrationProgress) {
		const prev = progressById.value.get(incoming.migrationId);
		const merged = mergeMigrationProgress(prev, incoming);
		const next = new Map(progressById.value);
		next.set(merged.migrationId, merged);
		progressById.value = next;

		if (incoming.migrationId !== focusedId.value) return;
		if (
			incoming.status === "running" ||
			incoming.status === "paused" ||
			isTerminalMigrationStatus(incoming.status)
		) {
			pendingAction.value = null;
		}
	}

	function seedOptimisticRunningProgress(
		migrationId: string,
		foldersTotal: number,
	): void {
		applyProgress({
			migrationId,
			status: "running",
			foldersTotal,
			foldersCompleted: 0,
			messagesTotal: 0,
			messagesCompleted: 0,
			messagesFailed: 0,
			bytesTransferred: 0,
			updatedAt: new Date().toISOString(),
		});
	}

	async function refreshEngineActive() {
		try {
			engineActiveIds.value = await getRpc().request.getActiveMigrationIds({});
		} catch {
			engineActiveIds.value = [];
		}
	}

	async function syncFocusedSnapshot() {
		const id = focusedId.value;
		if (!id) return;
		await refreshEngineActive();
		// While the engine is in memory it owns live activity/retry state; DB polls
		// only carry counters and would wipe countdowns or fight pause/resume.
		if (engineActiveIds.value.includes(id)) return;

		const snapshot = await getRpc().request.getMigrationProgress({ migrationId: id });
		if (snapshot) applyProgress(snapshot);
	}

	function listenForProgress() {
		electroview.rpc?.addMessageListener("migrationProgress", (payload) => {
			applyProgress(payload);
			if (payload.migrationId === focusedId.value) {
				void refreshEngineActive();
			}
			if (isTerminalMigrationStatus(payload.status)) {
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
			if (snapshot) applyProgress(snapshot);
		}
	}

	async function hydrateSessions() {
		try {
			await refreshHistory();
			await refreshEngineActive();
			await hydrateActiveProgress();
		} finally {
			sessionsHydrated.value = true;
		}
	}

	async function focusSession(migrationId: string) {
		focusedId.value = migrationId;
		pendingAction.value = null;
		resumeError.value = null;

		const record = history.value.find((r) => r.id === migrationId);
		let snapshot = progressById.value.get(migrationId) ?? null;
		const stale =
			Boolean(record && snapshot && snapshot.status !== record.status);

		if (!snapshot || stale) {
			snapshot = await getRpc().request.getMigrationProgress({ migrationId });
		}
		if (!snapshot && record) {
			snapshot = recordToProgress(record);
		}
		if (snapshot) applyProgress(snapshot);

		await refreshEngineActive();
	}

	function resetFocused() {
		focusedId.value = null;
		pendingAction.value = null;
		resumeError.value = null;
	}

	async function restoreSession(): Promise<boolean> {
		await hydrateSessions();
		const first = resumableIds.value[0];
		if (!first) return false;
		await focusSession(first);
		return true;
	}

	async function start(
		explicitResumeId?: string,
		options?: {
			plannedSecondsTypical?: number;
			launchTicket?: string;
			backupRootPath?: string | null;
			jobType?: "migrate" | "backup";
		},
	) {
		const rpc = getRpc();
		const isFreshStart =
			options?.jobType === "backup" ||
			options?.jobType === "migrate" ||
			Boolean(options?.backupRootPath) ||
			Boolean(options?.launchTicket);
		const resumeId =
			explicitResumeId ??
			(isFreshStart
				? undefined
				: focusedProgress.value?.status === "running" ||
						focusedProgress.value?.status === "paused" ||
						focusedProgress.value?.status === "failed"
					? (focusedId.value ?? undefined)
					: undefined);

		pendingAction.value = resumeId ? "resume" : "start";
		resumeError.value = null;

		try {
			const mailboxes = useMailboxesStore();
			const { migrationId } = resumeId
				? await rpc.request.startMigration({ resumeMigrationId: resumeId })
				: await rpc.request.startMigration({
						source: mailboxes.source,
						destination:
							options?.jobType === "backup" ? undefined : mailboxes.destination,
						folderMappings: mailboxes.folderMappings.filter((f) => f.selected),
						plannedSecondsTypical: options?.plannedSecondsTypical,
						launchTicket: options?.launchTicket,
						backupRootPath: options?.backupRootPath ?? null,
						jobType: options?.jobType ?? "migrate",
					});

			focusedId.value = migrationId;

			if (!resumeId) {
				const foldersTotal = mailboxes.folderMappings.filter((f) => f.selected).length;
				seedOptimisticRunningProgress(migrationId, foldersTotal);
			}

			await refreshEngineActive();
			try {
				const snapshot = await rpc.request.getMigrationProgress({ migrationId });
				if (snapshot) applyProgress(snapshot);
			} catch {
				await syncFocusedSnapshot();
			}
		} catch (error) {
			pendingAction.value = null;
			throw error;
		}
	}

	async function cancel() {
		if (!focusedId.value) return;
		const migrationId = focusedId.value;
		await getRpc().request.cancelMigration({ migrationId });
		pendingAction.value = null;
		// Apply cancelled immediately — syncFocusedSnapshot skips while the engine is in memory.
		const snapshot = await getRpc().request.getMigrationProgress({ migrationId });
		if (snapshot) applyProgress(snapshot);
		await refreshEngineActive();
		await refreshHistory();
	}

	async function pause() {
		if (!focusedId.value) return;
		await getRpc().request.pauseMigration({ migrationId: focusedId.value });
		pendingAction.value = null;
		await refreshEngineActive();
		await syncFocusedSnapshot();
	}

	async function resume() {
		if (!focusedId.value) return;
		pendingAction.value = "resume";
		resumeError.value = null;

		try {
			await getRpc().request.resumeMigration({ migrationId: focusedId.value });
			await refreshEngineActive();
			await syncFocusedSnapshot();
		} catch (error) {
			pendingAction.value = null;
			resumeError.value =
				error instanceof Error ? error.message : "Could not resume migration";
			throw error;
		}
	}

	watch(
		() => [focusedId.value, ui.value.phase] as const,
		([id, phase]) => {
			stopLiveTimers();
			if (!id || !isLiveUiPhase(phase)) return;

			uiClockTimer = setInterval(() => {
				uiClock.value = Date.now();
			}, UI_CLOCK_MS);

			progressPollTimer = setInterval(() => {
				void syncFocusedSnapshot();
			}, PROGRESS_POLL_MS);
		},
		{ immediate: true },
	);

	return {
		focusedId,
		progressById,
		progress,
		focusedProgress,
		history,
		resumableIds,
		activeSessions,
		pastSessions,
		hasSessionCards,
		sessionsHydrated,
		plannedDurationHint,
		ui,
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
		resume,
	};
});
