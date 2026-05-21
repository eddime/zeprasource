import { defineStore } from "pinia";
import { computed, nextTick, ref } from "vue";
import type {
	FolderMapping,
	ImapFolder,
	MailboxCredentials,
} from "../../shared/types";
import { applyProviderFromEmail } from "../../shared/mailbox-provider";
import { PROVIDER_PRESETS } from "../../shared/types";
import { splitImapHostInput } from "../../shared/imap-host-input";
import {
	isLocalTestEmail,
	isLocalTestMailbox,
	localTestMissingHostHint,
	LOCAL_IMAP_DEST,
	LOCAL_IMAP_SOURCE,
} from "../../shared/local-test-servers";
import { electroview, getRpc } from "../lib/electrobun";

function emptyCredentials(): MailboxCredentials {
	return {
		provider: "generic",
		email: "",
		host: "",
		port: 993,
		secure: true,
		authMethod: "password",
	};
}

export const useMailboxesStore = defineStore("mailboxes", () => {
	const source = ref<MailboxCredentials>(emptyCredentials());
	const destination = ref<MailboxCredentials>(emptyCredentials());
	const sourceFolders = ref<ImapFolder[]>([]);
	const destFolders = ref<ImapFolder[]>([]);
	const folderMappings = ref<FolderMapping[]>([]);
	const sourceValidated = ref(false);
	const destValidated = ref(false);
	const testingSource = ref(false);
	const testingDest = ref(false);
	const sourceTestError = ref<string | null>(null);
	const destTestError = ref<string | null>(null);
	const loadingFolderStats = ref(false);
	const measuringFolderBytes = ref(false);
	const folderStatsError = ref<string | null>(null);
	const folderStatsProgress = ref<{ completed: number; total: number } | null>(null);

	let activeFolderStatsRequestId: string | null = null;
	let folderStatsListenerReady = false;

	function ensureFolderStatsListener() {
		if (folderStatsListenerReady) return;
		electroview.rpc?.addMessageListener("folderStatsProgress", (payload) => {
			if (
				!activeFolderStatsRequestId ||
				payload.requestId !== activeFolderStatsRequestId
			) {
				return;
			}
			applySingleFolderStat(payload.folder);
			folderStatsProgress.value = {
				completed: payload.completed,
				total: payload.total,
			};
		});
		folderStatsListenerReady = true;
	}

	const sourcePreset = computed(() => PROVIDER_PRESETS[source.value.provider]);
	const destPreset = computed(() => PROVIDER_PRESETS[destination.value.provider]);

	function applyProviderPreset(target: "source" | "destination") {
		const creds = target === "source" ? source : destination;
		const preset = PROVIDER_PRESETS[creds.value.provider];
		if (preset.host) {
			creds.value.host = preset.host;
			creds.value.port = preset.port;
			creds.value.secure = preset.secure;
		}
	}

	async function testConnection(target: "source" | "destination") {
		const isSource = target === "source";
		const raw = isSource ? source.value : destination.value;
		const creds = {
			...raw,
			authMethod: "password" as const,
			port: typeof raw.port === "string" ? Number.parseInt(raw.port, 10) : raw.port,
		};
		if (isSource) source.value = creds;
		else destination.value = creds;

		if (!creds.email.trim()) {
			const msg = "Email is required.";
			if (isSource) sourceTestError.value = msg;
			else destTestError.value = msg;
			return false;
		}
		applyProviderFromEmail(creds, creds.email);
		if (isSource) source.value = { ...creds };
		else destination.value = { ...creds };
		if (!creds.password?.trim()) {
			const msg = "Password is required.";
			if (isSource) sourceTestError.value = msg;
			else destTestError.value = msg;
			return false;
		}
		if (isSource) {
			testingSource.value = true;
			sourceTestError.value = null;
		} else {
			testingDest.value = true;
			destTestError.value = null;
		}

		try {
			const rpc = getRpc();

			if (!creds.host.trim()) {
				if (isLocalTestEmail(creds.email)) {
					const msg = localTestMissingHostHint(target);
					if (isSource) sourceTestError.value = msg;
					else destTestError.value = msg;
					return false;
				}
				try {
					const connected = await rpc.request.connectMailbox({
						email: creds.email,
						password: creds.password!,
					});
					creds.host = connected.host;
					creds.port = connected.port;
					creds.secure = connected.secure;
					creds.provider = connected.provider;
					creds.accessProtocol = "imap";
					if (isSource) source.value = { ...creds };
					else destination.value = { ...creds };

					if (!connected.success) {
						const msg = connected.error ?? "Could not connect";
						if (isSource) {
							sourceTestError.value = msg;
							sourceValidated.value = false;
						} else {
							destTestError.value = msg;
							destValidated.value = false;
						}
						return false;
					}
					if (isSource) {
						sourceFolders.value = connected.folders ?? [];
					} else {
						destFolders.value = connected.folders ?? [];
					}
					buildFolderMappings();
					if (folderMappings.value.length === 0) {
						const msg = "Connected but no folders were found on this mailbox.";
						if (isSource) sourceTestError.value = msg;
						else destTestError.value = msg;
						return false;
					}
					await rpc.request.saveMailboxProfile({ role: target, credentials: creds });
					// Validated after credentials are on the model (avoids MailboxCard treating discovery as user edit).
					await nextTick();
					if (isSource) sourceValidated.value = true;
					else destValidated.value = true;
					return true;
				} catch (error) {
					const msg =
						error instanceof Error
							? error.message
							: "Could not find your mail server. Check email and password, or try again later.";
					if (isSource) sourceTestError.value = msg;
					else destTestError.value = msg;
					return false;
				}
			}

			if (isLocalTestMailbox(creds)) {
				creds.secure = false;
				if (isSource) source.value = { ...creds };
				else destination.value = { ...creds };
			}

			const result = await rpc.request.testConnection({ credentials: creds });
			if (!result.success) {
				const msg = result.error ?? "Could not connect";
				if (isSource) {
					sourceTestError.value = msg;
					sourceValidated.value = false;
				} else {
					destTestError.value = msg;
					destValidated.value = false;
				}
				return false;
			}
			if (isSource) {
				sourceFolders.value = result.folders ?? [];
			} else {
				destFolders.value = result.folders ?? [];
			}
			buildFolderMappings();
			await rpc.request.saveMailboxProfile({ role: target, credentials: creds });
			await nextTick();
			if (isSource) sourceValidated.value = true;
			else destValidated.value = true;
			return true;
		} catch (error) {
			const msg =
				error instanceof Error ? error.message : "Could not connect. Try again.";
			if (isSource) {
				sourceTestError.value = msg;
				sourceValidated.value = false;
			} else {
				destTestError.value = msg;
				destValidated.value = false;
			}
			return false;
		} finally {
			if (isSource) testingSource.value = false;
			else testingDest.value = false;
		}
	}

	function applyLocalPreset(preset: MailboxCredentials, target: "source" | "destination") {
		const { host, port } = splitImapHostInput(preset.host, preset.port);
		const creds: MailboxCredentials = { ...preset, host, port, secure: false };
		if (target === "source") {
			source.value = creds;
			sourceValidated.value = false;
			sourceTestError.value = null;
		} else {
			destination.value = creds;
			destValidated.value = false;
			destTestError.value = null;
		}
	}

	function applyLocalTestSource() {
		applyLocalPreset(LOCAL_IMAP_SOURCE, "source");
	}

	function applyLocalTestDest() {
		applyLocalPreset(LOCAL_IMAP_DEST, "destination");
	}

	async function applyEtherealTestMailboxes() {
		const rpc = getRpc();
		const pair = await rpc.request.createEtherealTestMailboxes({});
		source.value = { ...pair.source, authMethod: "password" };
		destination.value = { ...pair.destination, authMethod: "password" };
		sourceValidated.value = false;
		destValidated.value = false;
		sourceTestError.value = null;
		destTestError.value = null;
	}

	async function seedEtherealTestSource() {
		try {
			const rpc = getRpc();
			await rpc.request.seedEtherealTestSource({ credentials: source.value });
		} catch {
			/* optional */
		}
	}

	function normalizeFolderPath(path: string): string {
		return path.replace(/\\/g, "/").replace(/\/+/g, "/").trim().toLowerCase();
	}

	function findSourceFolder(sourcePath: string) {
		const direct = sourceFolders.value.find((f) => f.path === sourcePath);
		if (direct) return direct;
		const norm = normalizeFolderPath(sourcePath);
		return sourceFolders.value.find((f) => normalizeFolderPath(f.path) === norm);
	}

	function matchFolderStat(
		stats: Array<{ path: string; messages: number; bytes: number }>,
		sourcePath: string,
	) {
		const direct = stats.find((s) => s.path === sourcePath);
		if (direct) return direct;
		const norm = normalizeFolderPath(sourcePath);
		return stats.find((s) => normalizeFolderPath(s.path) === norm);
	}

	function buildFolderMappings() {
		folderMappings.value = sourceFolders.value.map((folder) => ({
			sourcePath: folder.path,
			destPath: folder.path,
			selected: !folder.attributes.includes("\\Noselect"),
			messages: folder.messageCount ?? 0,
			bytes: undefined,
		}));
	}

	function applySingleFolderStat(stat: {
		path: string;
		messages: number;
		bytes: number;
	}) {
		const norm = normalizeFolderPath(stat.path);
		folderMappings.value = folderMappings.value.map((mapping) =>
			mapping.sourcePath === stat.path ||
			normalizeFolderPath(mapping.sourcePath) === norm
				? { ...mapping, messages: stat.messages, bytes: stat.bytes }
				: mapping,
		);
	}

	function applyFolderStats(stats: Array<{ path: string; messages: number; bytes: number }>) {
		folderMappings.value = folderMappings.value.map((mapping) => {
			const stat = matchFolderStat(stats, mapping.sourcePath);
			if (!stat) return mapping;
			return { ...mapping, messages: stat.messages, bytes: stat.bytes };
		});
	}

	async function reloadSourceFolders(): Promise<boolean> {
		if (!sourceValidated.value) return false;
		try {
			const rpc = getRpc();
			const creds: MailboxCredentials = {
				...source.value,
				authMethod: "password",
				accessProtocol: "imap",
			};
			const result = await rpc.request.testConnection({ credentials: creds });
			if (!result.success || !result.folders?.length) return false;
			source.value = { ...creds };
			sourceFolders.value = result.folders;
			buildFolderMappings();
			return true;
		} catch {
			return false;
		}
	}

	function seedFolderMessageCounts() {
		folderMappings.value = folderMappings.value.map((mapping) => {
			const folder = findSourceFolder(mapping.sourcePath);
			const messages =
				typeof folder?.messageCount === "number"
					? folder.messageCount
					: typeof mapping.messages === "number"
						? mapping.messages
						: undefined;
			const bytes =
				messages === 0 ? 0 : mapping.bytes;
			return { ...mapping, messages, bytes };
		});
	}

	/** Folders still missing message count and/or byte size. */
	function pathsNeedingMeasurement(): string[] {
		return folderMappings.value
			.filter((m) => m.messages === undefined || m.bytes === undefined)
			.map((m) => m.sourcePath);
	}

	function selectedPathsNeedingBytes(): string[] {
		return folderMappings.value
			.filter(
				(m) =>
					m.selected &&
					(m.messages === undefined || m.bytes === undefined),
			)
			.map((m) => m.sourcePath);
	}

	async function loadFolderStats(force = false) {
		if (!sourceValidated.value) return;
		if (folderMappings.value.length === 0) {
			const loaded = await reloadSourceFolders();
			if (!loaded) return;
		}

		if (force) {
			folderMappings.value = folderMappings.value.map((mapping) => ({
				...mapping,
				messages: undefined,
				bytes: undefined,
			}));
		}

		seedFolderMessageCounts();

		if (
			!force &&
			folderMappings.value.every(
				(m) => m.messages !== undefined && m.bytes !== undefined,
			)
		) {
			return;
		}

		await measureAllFolderBytes(force);
	}

	async function measureAllFolderBytes(force = false) {
		if (!sourceValidated.value) return;

		const rpcPaths = pathsNeedingMeasurement();
		if (rpcPaths.length === 0) return;

		const priorityPaths = selectedPathsNeedingBytes();
		const requestId = crypto.randomUUID();
		activeFolderStatsRequestId = requestId;
		folderStatsProgress.value = { completed: 0, total: rpcPaths.length };
		ensureFolderStatsListener();

		loadingFolderStats.value = folderMappings.value.some((m) => m.messages === undefined);
		measuringFolderBytes.value = true;
		folderStatsError.value = null;
		try {
			const knownMessageCounts: Record<string, number> = {};
			for (const mapping of folderMappings.value) {
				if (!rpcPaths.includes(mapping.sourcePath)) continue;
				if (typeof mapping.messages === "number") {
					knownMessageCounts[mapping.sourcePath] = mapping.messages;
				}
			}

			const rpc = getRpc();
			const stats = await rpc.request.fetchFolderStats({
				source: source.value,
				folderPaths: rpcPaths,
				requestId,
				priorityPaths:
					priorityPaths.length > 0 ? priorityPaths : undefined,
				knownMessageCounts,
			});
			applyFolderStats(stats);
			await sweepIncompleteFolderStats(knownMessageCounts);
		} catch (error) {
			folderStatsError.value =
				error instanceof Error ? error.message : "Could not measure folder sizes";
		} finally {
			loadingFolderStats.value = false;
			measuringFolderBytes.value = false;
			if (activeFolderStatsRequestId === requestId) {
				activeFolderStatsRequestId = null;
				folderStatsProgress.value = null;
			}
		}
	}

	/** Second pass for folders LIST-STATUS skipped (empty or odd paths). */
	async function sweepIncompleteFolderStats(
		knownMessageCounts: Record<string, number> = {},
	) {
		const missing = pathsNeedingMeasurement();
		if (missing.length === 0) return;

		const requestId = crypto.randomUUID();
		activeFolderStatsRequestId = requestId;
		folderStatsProgress.value = {
			completed: 0,
			total: (folderStatsProgress.value?.total ?? 0) + missing.length,
		};
		ensureFolderStatsListener();

		try {
			const rpc = getRpc();
			const stats = await rpc.request.fetchFolderStats({
				source: source.value,
				folderPaths: missing,
				requestId,
				knownMessageCounts,
			});
			applyFolderStats(stats);
		} finally {
			if (activeFolderStatsRequestId === requestId) {
				activeFolderStatsRequestId = null;
			}
		}

		folderMappings.value = folderMappings.value.map((mapping) => {
			if (mapping.messages !== undefined && mapping.bytes !== undefined) {
				return mapping;
			}
			return {
				...mapping,
				messages: mapping.messages ?? 0,
				bytes: mapping.bytes ?? 0,
			};
		});
	}

	async function loadSavedProfiles(): Promise<void> {
		const rpc = getRpc();
		try {
			const [src, dest] = await Promise.all([
				rpc.request.getMailboxProfile({ role: "source" }),
				rpc.request.getMailboxProfile({ role: "destination" }),
			]);
			if (src) {
				source.value = { ...src };
				sourceValidated.value = Boolean(src.email && src.host);
			}
			if (dest) {
				destination.value = { ...dest };
				destValidated.value = Boolean(dest.email && dest.host);
			}
		} catch {
			/* profiles optional until connect step */
		}
	}

	/** Empty forms for a new migration (does not load saved profiles). */
	async function resetForNewMigration(): Promise<void> {
		source.value = emptyCredentials();
		destination.value = emptyCredentials();
		sourceFolders.value = [];
		destFolders.value = [];
		folderMappings.value = [];
		sourceValidated.value = false;
		destValidated.value = false;
		sourceTestError.value = null;
		destTestError.value = null;
		loadingFolderStats.value = false;
		measuringFolderBytes.value = false;
		folderStatsError.value = null;
		folderStatsProgress.value = null;
		activeFolderStatsRequestId = null;
		try {
			const rpc = getRpc();
			await rpc.request.clearMailboxProfiles({});
		} catch {
			/* UI is cleared even if vault cleanup fails */
		}
	}

	return {
		source,
		destination,
		sourceFolders,
		destFolders,
		folderMappings,
		sourceValidated,
		destValidated,
		testingSource,
		testingDest,
		sourceTestError,
		destTestError,
		loadingFolderStats,
		measuringFolderBytes,
		folderStatsError,
		folderStatsProgress,
		sourcePreset,
		destPreset,
		applyProviderPreset,
		applyLocalTestSource,
		applyLocalTestDest,
		applyEtherealTestMailboxes,
		seedEtherealTestSource,
		testConnection,
		buildFolderMappings,
		loadFolderStats,
		loadSavedProfiles,
		resetForNewMigration,
	};
});
