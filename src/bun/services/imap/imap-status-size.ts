import type { ImapFlow } from "imapflow";
import { createRequire } from "node:module";

// RFC 8438 STATUS=SIZE — exact bytes without FETCH (Dovecot, some hosts).
const require = createRequire(import.meta.url);
const imapTools = require("imapflow/lib/tools.js") as {
	normalizePath: (connection: unknown, path: string) => string;
	encodePath: (connection: unknown, path: string) => string;
};

type ImapExecClient = ImapFlow & {
	exec: (
		command: string,
		attributes: { type: string; value: string }[],
		options: {
			untagged: Record<string, (untagged: ImapUntagged) => Promise<void>>;
		},
	) => Promise<{ next: () => void }>;
	state: string;
	states: { AUTHENTICATED: string; SELECTED: string };
};

type ImapUntagged = {
	attributes?: Array<{ value?: string } | Array<{ value?: string }>>;
};

function capabilityHasStatusSize(client: ImapFlow): boolean {
	for (const cap of client.capabilities.keys()) {
		if (String(cap).toUpperCase().includes("STATUS=SIZE")) return true;
	}
	return false;
}

function parseStatusSizeFromUntagged(untagged: ImapUntagged): number | null {
	const list = untagged.attributes?.[1];
	if (!Array.isArray(list)) return null;

	for (let i = 0; i < list.length; i += 2) {
		const keyEntry = list[i];
		const valueEntry = list[i + 1];
		const key =
			keyEntry &&
			typeof keyEntry === "object" &&
			"value" in keyEntry &&
			typeof keyEntry.value === "string"
				? keyEntry.value.toUpperCase()
				: "";
		if (key !== "SIZE" || !valueEntry || typeof valueEntry !== "object") continue;
		const raw =
			"value" in valueEntry && typeof valueEntry.value === "string"
				? valueEntry.value
				: "";
		const parsed = Number(raw);
		if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
	}
	return null;
}

/** Exact folder size via STATUS SIZE (RFC 8438); null if unsupported or failed. */
export async function statusFolderBytes(
	client: ImapFlow,
	folderPath: string,
): Promise<number | null> {
	if (!capabilityHasStatusSize(client)) return null;

	const imap = client as ImapExecClient;
	if (![imap.states.AUTHENTICATED, imap.states.SELECTED].includes(imap.state)) {
		return null;
	}

	const path = imapTools.normalizePath(imap, folderPath);
	const encodedPath = imapTools.encodePath(imap, path);
	const pathAttr = {
		type: encodedPath.includes("&") ? "STRING" : "ATOM",
		value: encodedPath,
	};

	let sizeBytes: number | null = null;

	try {
		const response = await imap.exec(
			"STATUS",
			[pathAttr, [{ type: "ATOM", value: "SIZE" }]],
			{
				untagged: {
					STATUS: async (untagged: ImapUntagged) => {
						sizeBytes = parseStatusSizeFromUntagged(untagged);
					},
				},
			},
		);
		response.next();
	} catch {
		return null;
	}

	return sizeBytes;
}
