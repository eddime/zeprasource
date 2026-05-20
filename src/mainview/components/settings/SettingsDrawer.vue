<script setup lang="ts">
import { useSettingsStore } from "../../stores/settings";

const open = defineModel<boolean>("open", { default: false });
const settings = useSettingsStore();

function close() {
	open.value = false;
}
</script>

<template>
	<Teleport to="body">
		<Transition name="fade">
			<div v-if="open" class="backdrop" @click="close" />
		</Transition>
		<Transition name="sheet">
			<aside v-if="open" class="sheet sheet-side">
				<button type="button" class="x" aria-label="Close" @click="close">×</button>
				<h2>Settings</h2>

				<label class="row">
					<span>Appearance</span>
					<select
						:value="settings.settings.theme"
						@change="
							settings.save({
								theme: ($event.target as HTMLSelectElement).value as
									| 'system'
									| 'light'
									| 'dark',
							})
						"
					>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				</label>

				<p class="hint">
					Migration speed, retries, and duplicates are handled automatically — nothing to tune.
				</p>
			</aside>
		</Transition>
	</Teleport>
</template>

<style scoped>
.backdrop {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.2);
	z-index: 40;
}
.sheet {
	position: fixed;
	bottom: 0;
	left: 50%;
	transform: translateX(-50%);
	width: min(400px, 100%);
	background: var(--surface);
	border-radius: 24px 24px 0 0;
	padding: 1.5rem 1.25rem 2rem;
	z-index: 50;
	box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.12);
}
.x {
	position: absolute;
	top: 1rem;
	right: 1rem;
	width: 2rem;
	height: 2rem;
	border: none;
	background: var(--btn-secondary);
	border-radius: 50%;
	font-size: 1.2rem;
	cursor: pointer;
	color: var(--muted);
	line-height: 1;
}
h2 {
	margin: 0 0 1.25rem;
	font-size: 1.1rem;
	font-weight: 700;
}
.row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 1rem;
	font-size: 0.875rem;
}
select {
	padding: 0.45rem 0.75rem;
	border-radius: var(--radius-pill);
	border: 1px solid var(--border);
	background: var(--bg);
}
.hint {
	margin: 0.5rem 0 0;
	font-size: 0.8rem;
	color: var(--muted);
	line-height: 1.45;
}
.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}
.sheet-enter-active,
.sheet-leave-active {
	transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.sheet-enter-from,
.sheet-leave-to {
	transform: translateX(-50%) translateY(100%);
}
@media (min-width: 720px) {
	.sheet-side {
		bottom: auto;
		top: 0;
		right: 0;
		left: auto;
		transform: none;
		width: min(360px, 90vw);
		height: 100%;
		border-radius: 0;
		padding: 2rem 1.5rem;
		box-shadow: -20px 0 60px rgba(0, 0, 0, 0.08);
	}
	.sheet-enter-from,
	.sheet-leave-to {
		transform: translateX(100%);
	}
}
</style>
