<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { applyProviderFromEmail } from "../../../shared/mailbox-provider";
import type { MailboxCredentials } from "../../../shared/types";
import { PROVIDER_PRESETS } from "../../../shared/types";
import AppButton from "../ui/AppButton.vue";
import AppInput from "../ui/AppInput.vue";

const credentials = defineModel<MailboxCredentials>("credentials", { required: true });

const props = defineProps<{
	title: string;
	subtitle?: string;
	step?: number;
	validated: boolean;
	testing: boolean;
	error?: string | null;
}>();

const emit = defineEmits<{ verify: [] }>();

type CardView = "account" | "server";
const cardView = ref<CardView>("account");
const showConnectedOverlay = ref(false);

watch(
	() => props.validated,
	(ok) => {
		if (ok) {
			showConnectedOverlay.value = true;
			cardView.value = "account";
		} else {
			showConnectedOverlay.value = false;
		}
	},
	{ immediate: true },
);

const overlayVisible = computed(() => props.validated && showConnectedOverlay.value);

watch(
	() => credentials.value.email,
	(email, previousEmail) => {
		applyProviderFromEmail(credentials.value, email, previousEmail);
	},
);

const providerPreset = computed(() => PROVIDER_PRESETS[credentials.value.provider]);
const hint = computed(() => providerPreset.value.hint);
const hintLink = computed(() => providerPreset.value.hintLink);

const providerBadge = computed(() => {
	const label = PROVIDER_PRESETS[credentials.value.provider].label;
	return credentials.value.provider === "generic" ? null : label;
});

const passwordLabel = computed(() => {
	switch (credentials.value.provider) {
		case "gmail":
		case "outlook":
		case "icloud":
			return "App password";
		default:
			return "Password";
	}
});

const serverSummary = computed(() => {
	if (!credentials.value.host) return null;
	const tls = credentials.value.secure ? "TLS" : "no TLS";
	return `${credentials.value.host}:${credentials.value.port} · ${tls}`;
});

const usernameField = computed({
	get: () => credentials.value.username ?? "",
	set: (value: string) => {
		credentials.value.username = value.trim() || undefined;
	},
});

function toggleView() {
	cardView.value = cardView.value === "account" ? "server" : "account";
}

function openEditor() {
	showConnectedOverlay.value = false;
}
</script>

<template>
	<article
		class="card"
		:class="{
			ok: validated,
			'card-connected': overlayVisible,
			'view-server': cardView === 'server' && !overlayVisible,
		}"
	>
		<header class="card-top" :class="{ 'is-covered': overlayVisible }">
			<div class="card-identity">
				<span v-if="step != null" class="step-mark">{{ step }}</span>
				<div class="card-titles">
					<h3>{{ title }}</h3>
					<p v-if="subtitle" class="card-sub">{{ subtitle }}</p>
				</div>
			</div>
			<div v-if="!overlayVisible" class="card-actions">
				<button
					type="button"
					class="view-toggle"
					:class="{ on: cardView === 'server' }"
					:aria-pressed="cardView === 'server'"
					@click="toggleView"
				>
					{{ cardView === "server" ? "Account" : "Server" }}
				</button>
			</div>
		</header>

		<div class="card-main">
		<div class="card-body" :class="{ 'is-covered': overlayVisible }">
			<Transition name="card-swap" mode="out-in">
				<div v-if="cardView === 'account'" key="account" class="card-pane">
					<p v-if="providerBadge && !validated" class="provider-badge">{{ providerBadge }}</p>

					<div class="cred-stack">
						<AppInput
							v-model="credentials.email"
							label="Email"
							type="email"
							placeholder="you@mail.com"
							autocomplete="username"
						/>
						<AppInput
							v-model="credentials.password!"
							:label="passwordLabel"
							type="password"
							placeholder="••••••••"
							autocomplete="current-password"
							:error="error ?? undefined"
						/>
					</div>

					<p v-if="hint && !validated" class="hint-banner">
						<span>{{ hint }}</span>
						<a
							v-if="hintLink"
							class="hint-link"
							:href="hintLink.url"
							target="_blank"
							rel="noopener noreferrer"
						>
							{{ hintLink.label }}
						</a>
					</p>
					<p v-if="serverSummary && validated && !overlayVisible" class="server-pill">
						{{ serverSummary }}
					</p>
				</div>

				<div v-else key="server" class="card-pane">
					<p class="server-intro">Override IMAP host if auto-detect fails.</p>
					<div class="server-fields">
						<AppInput
							v-model="credentials.host"
							label="IMAP server"
							placeholder="Auto-detected on verify"
						/>
						<div class="port-row">
							<AppInput
								:model-value="String(credentials.port)"
								label="Port"
								type="number"
								placeholder="993"
								@update:model-value="credentials.port = Number($event) || 993"
							/>
							<label class="tls">
								<input v-model="credentials.secure" type="checkbox" />
								Use TLS
							</label>
						</div>
						<AppInput
							v-model="usernameField"
							label="Username (optional)"
							placeholder="Same as email if empty"
							autocomplete="username"
						/>
					</div>
				</div>
			</Transition>
		</div>

		<footer class="card-foot" :class="{ 'is-covered': overlayVisible }">
			<AppButton
				type="button"
				class="verify-btn"
				:variant="validated ? 'secondary' : 'primary'"
				block
				:loading="testing"
				@click="emit('verify')"
			>
				{{ validated ? "Re-verify connection" : "Verify connection" }}
			</AppButton>
		</footer>
		</div>

		<Transition name="overlay-fade">
			<div v-if="overlayVisible" class="connected-overlay" role="status">
				<div class="connected-content">
					<p class="connected-side">{{ title }}</p>
					<span class="connected-mark" aria-hidden="true">✓</span>
					<h4 class="connected-title">Connected</h4>
					<p class="connected-email">{{ credentials.email }}</p>
					<p v-if="serverSummary" class="connected-server">{{ serverSummary }}</p>
					<button type="button" class="make-changes-btn" @click="openEditor">
						Make changes
					</button>
				</div>
			</div>
		</Transition>
	</article>
</template>

<style scoped>
.card {
	--connected-bg: #99bd91;
	--connected-fg: #1a2418;
	--connected-muted: rgba(26, 36, 24, 0.62);
	position: relative;
	display: flex;
	flex-direction: column;
	min-height: 0;
	background: var(--surface);
	border: 1.5px solid var(--border);
	border-radius: 16px;
	overflow: hidden;
	box-shadow: 0 4px 24px rgba(0, 0, 0, 0.05);
	transition:
		border-color 0.2s ease,
		box-shadow 0.2s ease;
}

.card.ok:not(.card-connected) {
	border-color: var(--fg);
	box-shadow: 0 0 0 1px var(--fg);
}

.card.card-connected {
	border-color: #8aad82;
	box-shadow: none;
}

.card.view-server {
	border-color: color-mix(in srgb, var(--fg) 35%, var(--border));
}

.card-top {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.65rem 0.75rem;
	border-bottom: 1px solid var(--border);
	background: linear-gradient(180deg, #fff 0%, #fafafa 100%);
}

.card.ok:not(.card-connected) .card-top {
	background: linear-gradient(180deg, #fff 0%, #f5f5f5 100%);
}

.card-identity {
	display: flex;
	align-items: flex-start;
	gap: 0.55rem;
	min-width: 0;
	flex: 1;
}

.card-actions {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	flex-shrink: 0;
}

.view-toggle {
	border: 1.5px solid var(--border);
	background: var(--surface);
	color: var(--muted);
	font-size: 0.68rem;
	font-weight: 700;
	padding: 0.3rem 0.55rem;
	border-radius: 8px;
	cursor: pointer;
	white-space: nowrap;
	transition:
		border-color 0.15s ease,
		color 0.15s ease,
		background 0.15s ease;
}

.view-toggle:hover {
	color: var(--fg);
	border-color: color-mix(in srgb, var(--fg) 30%, var(--border));
}

.view-toggle.on {
	border-color: var(--fg);
	background: var(--fg);
	color: #fff;
}

.step-mark {
	flex-shrink: 0;
	width: 1.5rem;
	height: 1.5rem;
	border-radius: 8px;
	display: grid;
	place-items: center;
	font-size: 0.75rem;
	font-weight: 800;
	background: var(--fg);
	color: #fff;
}

.card-titles {
	min-width: 0;
}

.card-titles h3 {
	margin: 0;
	font-size: 0.95rem;
	font-weight: 800;
	letter-spacing: -0.02em;
	line-height: 1.15;
}

.card-sub {
	margin: 0.2rem 0 0;
	font-size: 0.75rem;
	line-height: 1.35;
	color: var(--muted);
}

.card-main {
	position: relative;
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.card-body {
	flex: 1;
	min-height: 0;
	padding: 0.55rem 0.75rem 0.5rem;
	overflow: hidden;
}

.card-pane {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	min-height: 0;
}

.card-swap-enter-active,
.card-swap-leave-active {
	transition:
		opacity 0.18s ease,
		transform 0.18s ease;
}

.card-swap-enter-from,
.card-swap-leave-to {
	opacity: 0;
	transform: translateY(4px);
}

.provider-badge {
	margin: 0;
	font-size: 0.72rem;
	font-weight: 700;
	color: var(--muted);
	letter-spacing: 0.02em;
}

.cred-stack {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.hint-banner {
	margin: 0;
	padding: 0.45rem 0.55rem;
	border-radius: 10px;
	font-size: 0.72rem;
	line-height: 1.4;
	color: var(--muted);
	background: var(--bg);
	border: 1px solid var(--border);
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
}

.hint-link {
	font-size: 0.72rem;
	font-weight: 700;
	color: var(--fg);
	text-decoration: underline;
	text-underline-offset: 3px;
}

.hint-link:hover {
	opacity: 0.75;
}

.server-pill {
	margin: 0;
	padding: 0.4rem 0.55rem;
	border-radius: 10px;
	font-size: 0.72rem;
	font-weight: 600;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	color: var(--fg);
	background: #f0f0f0;
	border: 1px solid var(--border);
}

.server-intro {
	margin: 0;
	font-size: 0.72rem;
	line-height: 1.4;
	color: var(--muted);
}

.server-fields {
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
}

.port-row {
	display: grid;
	grid-template-columns: 5.5rem 1fr;
	gap: 0.45rem;
	align-items: end;
}

.tls {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	min-height: 2.5rem;
	padding-bottom: 0.15rem;
	font-size: 0.75rem;
	color: var(--muted);
	cursor: pointer;
	white-space: nowrap;
}

.card-foot {
	flex-shrink: 0;
	padding: 0.5rem 0.75rem 0.65rem;
	border-top: 1px solid var(--border);
	background: #fafafa;
}

.card.ok:not(.card-connected) .card-foot {
	background: #f7f7f7;
}

.verify-btn {
	width: 100%;
}

.is-covered {
	pointer-events: none;
	user-select: none;
}

.connected-overlay {
	position: absolute;
	inset: 0;
	z-index: 5;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem 0.85rem;
	border-radius: inherit;
	background: var(--connected-bg);
}

.connected-content {
	width: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	gap: 0.35rem;
}

.connected-side {
	margin: 0 0 0.25rem;
	font-size: 0.65rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.12em;
	color: var(--connected-muted);
}

.connected-mark {
	width: 4.5rem;
	height: 4.5rem;
	margin: 0.15rem 0;
	border-radius: 50%;
	display: grid;
	place-items: center;
	font-size: 2.25rem;
	font-weight: 800;
	line-height: 1;
	background: #fff;
	color: var(--connected-fg);
}

.connected-title {
	margin: 0.1rem 0 0;
	font-size: 1.25rem;
	font-weight: 800;
	letter-spacing: -0.03em;
	color: var(--connected-fg);
}

.connected-email {
	margin: 0;
	width: 100%;
	font-size: 0.8rem;
	font-weight: 600;
	line-height: 1.35;
	color: var(--connected-fg);
	word-break: break-word;
}

.connected-server {
	margin: 0;
	width: 100%;
	font-size: 0.68rem;
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-weight: 500;
	color: var(--connected-muted);
}

.make-changes-btn {
	margin-top: 0.65rem;
	padding: 0;
	border: none;
	background: none;
	font-size: 0.78rem;
	font-weight: 700;
	color: var(--connected-muted);
	text-decoration: underline;
	text-underline-offset: 3px;
	cursor: pointer;
}

.make-changes-btn:hover {
	color: var(--connected-fg);
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
	transition: opacity 0.15s ease;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
	opacity: 0;
}
</style>
