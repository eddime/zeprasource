import { defineStore } from "pinia";
import { computed, ref } from "vue";
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
import { getRpc } from "../lib/electrobun";

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
	const folderStatsError = ref<string | null>(null);

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
					const discovered = await rpc.request.discoverImapSettings({
						email: creds.email,
						password: creds.password,
					});
					creds.host = discovered.host;
					creds.port = discovered.port;
					creds.secure = discovered.secure;
					creds.provider = discovered.provider;
					if (isSource) source.value = { ...creds };
					else destination.value = { ...creds };
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
				sourceValidated.value = true;
			} else {
				destFolders.value = result.folders ?? [];
				destValidated.value = true;
			}
			buildFolderMappings();
			await rpc.request.saveMailboxProfile({ role: target, credentials: creds });
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

	function buildFolderMappings() {
		folderMappings.value = sourceFolders.value.map((folder) => ({
			sourcePath: folder.path,
			destPath: folder.path,
			selected: !folder.attributes.includes("\\Noselect"),
		}));
	}

	function applyFolderStats(stats: Array<{ path: string; messages: number; bytes: number }>) {
		const byPath = new Map(stats.map((s) => [s.path, s]));
		folderMappings.value = folderMappings.value.map((mapping) => {
			const stat = byPath.get(mapping.sourcePath);
			if (!stat) return { ...mapping, messages: undefined, bytes: undefined };
			return { ...mapping, messages: stat.messages, bytes: stat.bytes };
		});
	}

	async function loadFolderStats(force = false) {
		if (!sourceValidated.value || folderMappings.value.length === 0) return;
		if (
			!force &&
			folderMappings.value.every((m) => m.messages !== undefined && m.bytes !== undefined)
		) {
			return;
		}

		loadingFolderStats.value = true;
		folderStatsError.value = null;
		try {
			const rpc = getRpc();
			const stats = await rpc.request.fetchFolderStats({
				source: source.value,
				folderPaths: folderMappings.value.map((m) => m.sourcePath),
			});
			applyFolderStats(stats);
		} catch (error) {
			folderStatsError.value =
				error instanceof Error ? error.message : "Could not measure folders";
		} finally {
			loadingFolderStats.value = false;
		}
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
		folderStatsError.value = null;
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
		folderStatsError,
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
