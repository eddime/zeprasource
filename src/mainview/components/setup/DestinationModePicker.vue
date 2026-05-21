<script setup lang="ts">
import { BACKUP_COPY } from "../../../shared/backup-copy";

export type ConnectTarget = "mail" | "backup";

const model = defineModel<ConnectTarget | null>({ required: true });
</script>

<template>
	<article class="card card--to">
		<header class="card-top">
			<div class="card-identity">
				<span class="role-badge">To</span>
				<p class="card-sub">Where your mail should land</p>
			</div>
		</header>

		<div class="card-main">
			<div class="card-body">
				<div class="card-pane" role="group" aria-label="Where should your mail go?">
					<button
						type="button"
						class="dest-option"
						:class="{ 'dest-option--active': model === 'mail' }"
						@click="model = 'mail'"
					>
						<span class="dest-option-icon" aria-hidden="true">
							<svg viewBox="0 0 24 24" fill="none">
								<path
									d="M3.75 6.75h16.5v10.5H3.75V6.75Z"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linejoin="round"
								/>
								<path
									d="m4.5 7.5 7.5 5.25L19.5 7.5"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</span>
						<span class="dest-option-copy">
							<span class="dest-option-title">Mail</span>
							<span class="dest-option-hint">Gmail, iCloud, or any IMAP server</span>
						</span>
					</button>

					<button
						type="button"
						class="dest-option"
						:class="{ 'dest-option--active': model === 'backup' }"
						@click="model = 'backup'"
					>
						<span class="dest-option-icon" aria-hidden="true">
							<svg viewBox="0 0 24 24" fill="none">
								<path
									d="M4 8.5V18a1.5 1.5 0 0 0 1.5 1.5H14A1.5 1.5 0 0 0 15.5 16.5V10.2L19.5 6H9L7 4H4.5A1.5 1.5 0 0 0 3 5.5V8"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linejoin="round"
								/>
								<path
									d="M12 13v5"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
								/>
								<path
									d="M9.5 15.5 12 18l2.5-2.5"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</span>
						<span class="dest-option-copy">
							<span class="dest-option-title">{{ BACKUP_COPY.connectTargetLabel }}</span>
							<span class="dest-option-hint">{{ BACKUP_COPY.connectTargetHint }}</span>
						</span>
					</button>
				</div>
			</div>
		</div>
	</article>
</template>

<style scoped>
.card {
	position: relative;
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 20px;
	overflow: hidden;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.05);
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
	padding: 0.65rem 0.85rem 0.75rem;
	display: flex;
	flex-direction: column;
}

.card-pane {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.dest-option {
	flex: 1;
	width: 100%;
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 0.7rem;
	padding: 0.7rem 0.75rem;
	border-radius: 12px;
	border: 1px solid var(--border);
	background: var(--bg);
	text-align: left;
	cursor: pointer;
	transition:
		border-color 0.15s ease,
		background 0.15s ease,
		box-shadow 0.15s ease;
}

.dest-option:hover {
	border-color: color-mix(in srgb, var(--fg) 30%, var(--border));
}

.dest-option--active {
	border-color: var(--fg);
	background: #fff;
	box-shadow: 0 0 0 1px var(--fg);
}

.dest-option-icon {
	flex-shrink: 0;
	width: 2.65rem;
	height: 2.65rem;
	display: grid;
	place-items: center;
	border-radius: 11px;
	border: 1px solid var(--border);
	background: #fff;
	color: var(--fg);
}

.dest-option-icon svg {
	width: 1.4rem;
	height: 1.4rem;
}

.dest-option--active .dest-option-icon {
	background: var(--fg);
	border-color: var(--fg);
	color: #fff;
}

.dest-option-copy {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
}

.dest-option-title {
	font-family: var(--font-display);
	font-size: 0.875rem;
	font-weight: 700;
	letter-spacing: -0.02em;
	color: var(--fg);
}

.dest-option-hint {
	font-size: 0.72rem;
	line-height: 1.35;
	color: var(--muted);
}
</style>
