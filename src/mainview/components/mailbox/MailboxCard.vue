<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { applyProviderFromEmail, emailDomain } from "../../../shared/mailbox-provider";
import { getRpc } from "../../lib/electrobun";
import { splitImapHostInput } from "../../../shared/imap-host-input";
import type { MailboxCredentials } from "../../../shared/types";
import { PROVIDER_PRESETS } from "../../../shared/types";
import AppInput from "../ui/AppInput.vue";

const credentials = defineModel<MailboxCredentials>("credentials", { required: true });

const props = defineProps<{
	title: string;
	subtitle?: string;
	role: "from" | "to";
	validated: boolean;
	testing: boolean;
	error?: string | null;
}>();

const emit = defineEmits<{ verify: []; credentialsEdited: [] }>();

const showConnectedOverlay = ref(false);

watch(
	() => props.validated,
	(ok) => {
		if (ok) showConnectedOverlay.value = true;
		else showConnectedOverlay.value = false;
	},
	{ immediate: true },
);

const overlayVisible = computed(() => props.validated && showConnectedOverlay.value);

const localError = ref<string | null>(null);
const displayError = computed(() => props.error ?? localError.value);

let prefetchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDiscoveryPrefetch(email: string) {
	if (prefetchTimer) clearTimeout(prefetchTimer);
	if (props.validated || props.testing || credentials.value.host.trim()) return;

	const trimmed = email.trim();
	const domain = emailDomain(trimmed);
	if (!domain || !trimmed.includes("@")) return;

	prefetchTimer = setTimeout(() => {
		prefetchTimer = null;
		void getRpc().request.prefetchMailDiscovery({ email: trimmed }).catch(() => {
			/* prefetch is best-effort */
		});
	}, 400);
}

onUnmounted(() => {
	if (prefetchTimer) clearTimeout(prefetchTimer);
});

watch(
	() => credentials.value.email,
	(email, previousEmail) => {
		applyProviderFromEmail(credentials.value, email, previousEmail);
		scheduleDiscoveryPrefetch(email);
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

const verifyLabel = computed(() => {
	if (props.testing) return "Checking connection…";
	if (props.validated) return "Check again";
	return "Check connection";
});

function normalizeServerHost(): void {
	const { host, port } = splitImapHostInput(
		credentials.value.host,
		credentials.value.port,
	);
	credentials.value.host = host;
	credentials.value.port = port;
}

function openEditor() {
	showConnectedOverlay.value = false;
	if (props.validated) emit("credentialsEdited");
}

function onVerifyClick() {
	localError.value = null;
	normalizeServerHost();
	if (!credentials.value.email.trim()) {
		localError.value = "Please enter your email address.";
		return;
	}
	if (!credentials.value.password?.trim()) {
		localError.value = "Please enter your password.";
		return;
	}
	emit("verify");
}

watch(
	credentials,
	() => {
		localError.value = null;
		if (props.validated) {
			openEditor();
		}
	},
	{ deep: true },
);
</script>

<template>
	<article
		class="card"
		:class="[`card--${role}`, { ok: validated, 'is-connected': overlayVisible }]"
	>
		<header v-if="!overlayVisible" class="card-top">
			<div class="card-identity">
				<span class="role-badge">{{ title }}</span>
				<p v-if="subtitle" class="card-sub">{{ subtitle }}</p>
			</div>
		</header>

		<div class="card-main">
			<div class="card-body" :class="{ 'is-dimmed': overlayVisible }">
				<div class="card-pane">
					<p v-if="providerBadge && !overlayVisible" class="provider-badge">
						{{ providerBadge }}
					</p>

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
						/>
					</div>

					<p v-if="hint && !overlayVisible" class="hint-banner">
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
				</div>
			</div>

			<footer v-show="!overlayVisible" class="card-foot">
				<p v-if="displayError" class="verify-error" role="alert">
					{{ displayError }}
				</p>
				<button
					type="button"
					class="verify-btn"
					:class="{
						'is-loading': testing,
						'is-ok': validated && !testing,
						'is-idle': !validated && !testing,
						'has-error': Boolean(displayError) && !testing,
					}"
					:disabled="testing"
					:aria-busy="testing"
					@click="onVerifyClick"
				>
					<span v-if="testing" class="verify-spin" aria-hidden="true" />
					<span v-else-if="validated" class="verify-check" aria-hidden="true">✓</span>
					<span class="verify-text">{{ verifyLabel }}</span>
				</button>
			</footer>
		</div>

		<Transition name="connected">
			<div
				v-if="overlayVisible"
				class="connected-overlay"
				role="status"
				:aria-label="`${title} mailbox connected`"
			>
				<div class="connected-content">
					<p class="connected-role">{{ title }}</p>
					<span class="connected-check" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none">
							<path
								d="M8 12.2 10.6 14.8 16 9.4"
								stroke="currentColor"
								stroke-width="2.25"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</span>
					<p class="connected-title">Connected</p>
					<p class="connected-email">{{ credentials.email }}</p>
					<p v-if="providerBadge" class="connected-provider">{{ providerBadge }}</p>
					<button type="button" class="connected-change-btn" @click="openEditor">
						Change email or password
					</button>
				</div>
			</div>
		</Transition>
	</article>
</template>

<style scoped>
.card {
	position: relative;
	display: flex;
	flex-direction: column;
	min-height: 0;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 20px;
	overflow: hidden;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
	transition:
		border-color 0.25s ease,
		box-shadow 0.25s ease;
}

.card.ok:not(.is-connected) {
	border-color: var(--fg);
	box-shadow: 0 0 0 1px var(--fg);
}

.card.is-connected {
	border-color: #8aad82;
	box-shadow:
		0 0 0 2px rgba(138, 173, 130, 0.35),
		0 8px 32px rgba(95, 122, 89, 0.1);
}

.card-top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.5rem;
	padding: 0.5rem 0.7rem;
	border-bottom: 1px solid var(--border);
	background: var(--surface);
}

.card-identity {
	display: flex;
	align-items: baseline;
	gap: 0.45rem;
	min-width: 0;
	flex: 1;
	flex-wrap: wrap;
}

.role-badge {
	flex-shrink: 0;
	font-family: var(--font-display);
	font-size: 1rem;
	font-weight: 800;
	letter-spacing: -0.03em;
	line-height: 1.1;
	color: var(--fg);
}

.card-sub {
	margin: 0;
	font-size: 0.68rem;
	line-height: 1.3;
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
	padding: 0.65rem 0.85rem 0.55rem;
	overflow-x: hidden;
	overflow-y: auto;
	overscroll-behavior: contain;
	scrollbar-width: thin;
	scrollbar-color: color-mix(in srgb, var(--muted) 55%, transparent) transparent;
	transition: opacity 0.25s ease;
}

.card-body.is-dimmed {
	opacity: 0.35;
	pointer-events: none;
	user-select: none;
}

.card-body::-webkit-scrollbar {
	width: 6px;
}

.card-body::-webkit-scrollbar-thumb {
	background: var(--border);
	border-radius: 999px;
}

.card-pane {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	min-height: 0;
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

.cred-stack :deep(.inp) {
	border-radius: 12px;
	background: #fff;
	transition:
		border-color 0.15s ease,
		box-shadow 0.15s ease;
}

.cred-stack :deep(.inp:focus) {
	box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.06);
}

.hint-banner {
	margin: 0;
	padding: 0.5rem 0.65rem;
	border-radius: 12px;
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

.card-foot {
	flex-shrink: 0;
	padding: 0.55rem 0.85rem 0.75rem;
	border-top: 1px solid var(--border);
	background: #fafafa;
}

.card.ok .card-foot {
	background: #f7f7f7;
}

.verify-error {
	margin: 0 0 0.65rem;
	padding: 0.55rem 0.7rem;
	font-size: 0.78rem;
	line-height: 1.4;
	color: #9f1239;
	background: rgba(159, 18, 57, 0.08);
	border: 1px solid rgba(159, 18, 57, 0.2);
	border-radius: 10px;
}

.verify-btn {
	width: 100%;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.45rem;
	padding: 0.62rem 0.85rem;
	border-radius: 12px;
	border: 1.5px solid transparent;
	font-family: var(--font-display);
	font-size: 0.8125rem;
	font-weight: 700;
	letter-spacing: -0.02em;
	line-height: 1.2;
	cursor: pointer;
	transition:
		background 0.2s ease,
		border-color 0.2s ease,
		color 0.2s ease,
		transform 0.15s ease,
		box-shadow 0.2s ease;
}

.verify-btn.is-idle {
	background: var(--fg);
	color: #fff;
	border-color: var(--fg);
	box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.verify-btn.is-idle:hover:not(:disabled) {
	transform: translateY(-1px);
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
}

.verify-btn.is-idle:active:not(:disabled) {
	transform: translateY(0);
	box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
}

.verify-btn.has-error.is-idle {
	box-shadow: 0 0 0 3px rgba(159, 18, 57, 0.12);
}

.verify-btn.is-loading {
	background: #1a1a1a;
	color: rgba(255, 255, 255, 0.9);
	border-color: #1a1a1a;
	cursor: wait;
}

.verify-btn.is-ok {
	background: #f4f8f2;
	color: #2d3d2a;
	border-color: #9eb896;
}

.verify-btn.is-ok:hover:not(:disabled) {
	background: #eaf2e8;
	border-color: #8aad82;
}

.verify-btn:disabled {
	opacity: 1;
	cursor: wait;
}

.verify-spin {
	flex-shrink: 0;
	width: 0.95rem;
	height: 0.95rem;
	border: 2px solid rgba(255, 255, 255, 0.35);
	border-top-color: #fff;
	border-radius: 50%;
	animation: verify-spin 0.65s linear infinite;
}

.verify-check {
	flex-shrink: 0;
	width: 1.15rem;
	height: 1.15rem;
	border-radius: 50%;
	display: grid;
	place-items: center;
	font-size: 0.65rem;
	font-weight: 800;
	line-height: 1;
	background: #8aad82;
	color: #fff;
}

.verify-text {
	min-width: 0;
}

@keyframes verify-spin {
	to {
		transform: rotate(360deg);
	}
}

.connected-overlay {
	position: absolute;
	inset: 0;
	z-index: 6;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem 0.85rem;
	border-radius: inherit;
	background: color-mix(in srgb, var(--surface) 94%, transparent);
	backdrop-filter: blur(12px);
}

.connected-content {
	width: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	gap: 0.45rem;
}

.connected-role {
	margin: 0;
	font-family: var(--font-display);
	font-size: 1rem;
	font-weight: 800;
	letter-spacing: -0.03em;
	color: var(--fg);
}

.connected-check {
	width: 2.75rem;
	height: 2.75rem;
	border-radius: 50%;
	display: grid;
	place-items: center;
	color: #fff;
	background: #8aad82;
	box-shadow: 0 0 0 6px rgba(138, 173, 130, 0.22);
}

.connected-check svg {
	width: 1.35rem;
	height: 1.35rem;
}

.connected-title {
	margin: 0.15rem 0 0;
	font-family: var(--font-display);
	font-size: 1.15rem;
	font-weight: 800;
	letter-spacing: -0.03em;
	color: var(--fg);
}

.connected-email {
	margin: 0;
	width: 100%;
	font-size: 0.8rem;
	font-weight: 600;
	line-height: 1.35;
	color: var(--fg);
	word-break: break-word;
}

.connected-provider {
	margin: 0;
	font-size: 0.68rem;
	font-weight: 700;
	color: var(--muted);
}

.connected-change-btn {
	margin-top: 0.45rem;
	width: 100%;
	padding: 0.58rem 0.75rem;
	border: 1.5px solid var(--border);
	border-radius: 12px;
	background: var(--bg);
	font-family: var(--font-display);
	font-size: 0.78rem;
	font-weight: 700;
	color: var(--fg);
	cursor: pointer;
	transition:
		background 0.15s ease,
		border-color 0.15s ease,
		transform 0.15s ease;
}

.connected-change-btn:hover {
	background: #fff;
	border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
	transform: translateY(-1px);
}

.connected-change-btn:active {
	transform: translateY(0);
}

.connected-enter-active {
	transition: opacity 0.28s ease;
}

.connected-leave-active {
	transition: opacity 0.2s ease;
}

.connected-enter-active .connected-content {
	animation: connected-content-in 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.connected-leave-active .connected-content {
	animation: connected-content-out 0.22s ease forwards;
}

.connected-enter-active .connected-check {
	animation: connected-check-in 0.5s cubic-bezier(0.22, 1.25, 0.36, 1) 0.12s both;
}

.connected-enter-from,
.connected-leave-to {
	opacity: 0;
}

@keyframes connected-content-in {
	from {
		opacity: 0;
		transform: translateY(14px);
	}

	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@keyframes connected-content-out {
	from {
		opacity: 1;
		transform: translateY(0);
	}

	to {
		opacity: 0;
		transform: translateY(8px);
	}
}

@keyframes connected-check-in {
	from {
		opacity: 0;
		transform: scale(0.4);
	}

	to {
		opacity: 1;
		transform: scale(1);
	}
}

@media (prefers-reduced-motion: reduce) {
	.connected-enter-active .connected-content,
	.connected-leave-active .connected-content,
	.connected-enter-active .connected-check {
		animation: none;
	}
}
</style>
