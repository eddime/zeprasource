<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
	LOCAL_IMAP_DEST,
	LOCAL_IMAP_DOCKER_CMD,
	LOCAL_IMAP_SOURCE,
} from "../../../shared/local-test-servers";
import AppButton from "../ui/AppButton.vue";
import { getRpc } from "../../lib/electrobun";

const emit = defineEmits<{
	applySource: [];
	applyDest: [];
	applyCloud: [];
}>();

const cloudLoading = ref(false);

const sourceOnline = ref<boolean | null>(null);
const destOnline = ref<boolean | null>(null);
const checking = ref(false);
const seeding = ref(false);
const seedMessage = ref<string | null>(null);

async function refreshStatus() {
	checking.value = true;
	seedMessage.value = null;
	try {
		const rpc = getRpc();
		const status = await rpc.request.checkLocalTestServers({});
		sourceOnline.value = status.source;
		destOnline.value = status.destination;
	} catch {
		sourceOnline.value = false;
		destOnline.value = false;
	} finally {
		checking.value = false;
	}
}

async function seedSource() {
	seeding.value = true;
	seedMessage.value = null;
	try {
		const rpc = getRpc();
		const result = await rpc.request.seedLocalTestSource({});
		seedMessage.value = result.ok
			? "Test email added to source INBOX."
			: (result.error ?? "Could not seed mailbox.");
		await refreshStatus();
	} catch (error) {
		seedMessage.value =
			error instanceof Error ? error.message : "Could not seed mailbox.";
	} finally {
		seeding.value = false;
	}
}

async function useCloudMailboxes() {
	cloudLoading.value = true;
	seedMessage.value = null;
	try {
		emit("applyCloud");
		seedMessage.value =
			"Cloud test mailboxes loaded (imap.ethereal.email). Click Verify on both cards, then migrate.";
		sourceOnline.value = null;
		destOnline.value = null;
	} finally {
		cloudLoading.value = false;
	}
}

onMounted(refreshStatus);
</script>

<template>
	<details class="panel">
		<summary class="panel-summary">
			<span>Local test servers <em>(optional)</em></span>
			<AppButton
				variant="secondary"
				size="sm"
				:loading="checking"
				@click.stop="refreshStatus"
			>
				Check
			</AppButton>
		</summary>

		<div class="panel-body">
		<p class="intro">
			Two IMAP servers on your machine for generic migration tests. Start them first:
		</p>

		<code class="cmd">{{ LOCAL_IMAP_DOCKER_CMD }}</code>
		<p class="warn">
			Host field: only <strong>127.0.0.1</strong> — not <code>127.0.0.1:1143</code> and not
			<code>imap-source</code>.
		</p>

		<div class="servers">
			<article class="server" :class="{ online: sourceOnline === true, offline: sourceOnline === false }">
				<div class="server-head">
					<strong>Source (From)</strong>
					<span class="dot" :title="sourceOnline === null ? 'Unknown' : sourceOnline ? 'Online' : 'Offline'" />
				</div>
				<dl>
					<div><dt>Host</dt><dd>{{ LOCAL_IMAP_SOURCE.host }}:{{ LOCAL_IMAP_SOURCE.port }}</dd></div>
					<div><dt>TLS</dt><dd>Off</dd></div>
					<div><dt>Email</dt><dd>{{ LOCAL_IMAP_SOURCE.email }}</dd></div>
					<div><dt>Password</dt><dd>{{ LOCAL_IMAP_SOURCE.password }}</dd></div>
				</dl>
				<AppButton variant="primary" size="sm" block @click="emit('applySource')">
					Use as From
				</AppButton>
			</article>

			<article class="server" :class="{ online: destOnline === true, offline: destOnline === false }">
				<div class="server-head">
					<strong>Destination (To)</strong>
					<span class="dot" :title="destOnline === null ? 'Unknown' : destOnline ? 'Online' : 'Offline'" />
				</div>
				<dl>
					<div><dt>Host</dt><dd>{{ LOCAL_IMAP_DEST.host }}:{{ LOCAL_IMAP_DEST.port }}</dd></div>
					<div><dt>TLS</dt><dd>Off</dd></div>
					<div><dt>Email</dt><dd>{{ LOCAL_IMAP_DEST.email }}</dd></div>
					<div><dt>Password</dt><dd>{{ LOCAL_IMAP_DEST.password }}</dd></div>
				</dl>
				<AppButton variant="primary" size="sm" block @click="emit('applyDest')">
					Use as To
				</AppButton>
			</article>
		</div>

		<div class="seed-row">
			<AppButton variant="secondary" size="sm" :loading="seeding" :disabled="sourceOnline !== true" @click="seedSource">
				Add test email to source
			</AppButton>
			<p v-if="seedMessage" class="seed-msg">{{ seedMessage }}</p>
			<p v-else-if="sourceOnline === false" class="seed-hint">
				Nothing on 127.0.0.1:1143 — install
				<a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noreferrer"
					>Docker Desktop</a
				>, run <code>bun run imap:up</code>, then Check. Or use cloud test below.
			</p>
		</div>

		<div class="cloud">
			<p><strong>No Docker?</strong> Use two temporary online IMAP accounts (internet required).</p>
			<AppButton variant="secondary" size="sm" block :loading="cloudLoading" @click="useCloudMailboxes">
				Use cloud test mailboxes
			</AppButton>
		</div>
		</div>
	</details>
</template>

<style scoped>
.panel {
	flex-shrink: 0;
	width: 100%;
	max-width: 100%;
	border: 1px dashed var(--border);
	border-radius: 14px;
	background: color-mix(in oklab, var(--bg) 70%, var(--surface));
}

.panel-summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.45rem 0.65rem;
	cursor: pointer;
	list-style: none;
	font-size: 0.78rem;
	font-weight: 700;
}

.panel-summary::-webkit-details-marker {
	display: none;
}

.panel-summary em {
	font-style: normal;
	font-weight: 500;
	color: var(--muted);
}

.panel-body {
	padding: 0 0.65rem 0.65rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.intro {
	margin: 0;
	font-size: 0.68rem;
	color: var(--muted);
	line-height: 1.35;
}
.warn {
	margin: 0;
	font-size: 0.72rem;
	color: var(--muted);
	line-height: 1.4;
}
.warn code {
	font-size: 0.68rem;
}
.cmd {
	display: block;
	font-size: 0.68rem;
	padding: 0.45rem 0.55rem;
	border-radius: 8px;
	background: var(--surface);
	border: 1px solid var(--border);
	color: var(--fg);
	word-break: break-all;
}
.servers {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.65rem;
}
@media (max-width: 720px) {
	.servers {
		grid-template-columns: 1fr;
	}
}
.server {
	border: 1px solid var(--border);
	border-radius: 10px;
	padding: 0.5rem;
	background: var(--surface);
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
}
.server.online {
	border-color: #16a34a;
}
.server.offline {
	border-color: #f87171;
}
.server-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
}
.server-head strong {
	font-size: 0.78rem;
}
.dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--muted-light);
}
.server.online .dot {
	background: #16a34a;
}
.server.offline .dot {
	background: #ef4444;
}
dl {
	margin: 0;
	display: grid;
	gap: 0.25rem;
}
dl > div {
	display: grid;
	grid-template-columns: 4.5rem 1fr;
	gap: 0.35rem;
	font-size: 0.72rem;
}
dt {
	color: var(--muted);
}
dd {
	margin: 0;
	font-family: ui-monospace, monospace;
	word-break: break-all;
}
.seed-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5rem;
}
.seed-msg,
.seed-hint {
	margin: 0;
	font-size: 0.72rem;
	color: var(--muted);
}
.seed-hint a {
	color: var(--fg);
}
.cloud {
	border-top: 1px solid var(--border);
	padding-top: 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
.cloud p {
	margin: 0;
	font-size: 0.72rem;
	color: var(--muted);
	line-height: 1.35;
}
</style>
