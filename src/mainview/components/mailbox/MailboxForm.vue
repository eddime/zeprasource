<script setup lang="ts">
import { computed } from "vue";
import type { MailboxCredentials, MailboxProvider } from "../../../shared/types";
import { PROVIDER_PRESETS } from "../../../shared/types";
import AppButton from "../ui/AppButton.vue";
import AppInput from "../ui/AppInput.vue";

const credentials = defineModel<MailboxCredentials>("credentials", { required: true });

defineProps<{
	testing?: boolean;
	testError?: string | null;
}>();

const emit = defineEmits<{
	test: [];
}>();

const providers = Object.entries(PROVIDER_PRESETS) as [MailboxProvider, (typeof PROVIDER_PRESETS)[MailboxProvider]][];

const presetHint = computed(() => PROVIDER_PRESETS[credentials.value.provider].hint);

function onProviderChange(event: Event) {
	const value = (event.target as HTMLSelectElement).value as MailboxProvider;
	credentials.value.provider = value;
	const preset = PROVIDER_PRESETS[value];
	if (preset.host) {
		credentials.value.host = preset.host;
		credentials.value.port = preset.port;
		credentials.value.secure = preset.secure;
	}
}
</script>

<template>
	<form class="mailbox-form" @submit.prevent="emit('test')">
		<label class="field">
			<span class="label">Provider</span>
			<select class="select" :value="credentials.provider" @change="onProviderChange">
				<option v-for="[key, preset] in providers" :key="key" :value="key">
					{{ preset.label }}
				</option>
			</select>
		</label>

		<AppInput v-model="credentials.email" label="Email address" type="email" placeholder="you@example.com" />

		<div v-if="credentials.provider === 'generic'" class="grid-2">
			<AppInput v-model="credentials.host" label="IMAP host" placeholder="imap.example.com" />
			<AppInput v-model="credentials.port" label="Port" type="number" />
		</div>

		<label class="field checkbox">
			<input v-model="credentials.secure" type="checkbox" />
			Use TLS (recommended)
		</label>

		<AppInput
			v-model="credentials.password!"
			label="Password / app password"
			type="password"
			autocomplete="off"
			:hint="presetHint"
		/>

		<p v-if="testError" class="form-error">{{ testError }}</p>

		<AppButton type="submit" :loading="testing" size="lg">
			Test connection &amp; load folders
		</AppButton>
	</form>
</template>

<style scoped>
.mailbox-form {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}
.field .label {
	font-size: 0.8125rem;
	color: var(--muted);
	font-weight: 500;
}
.select {
	width: 100%;
	padding: 0.65rem 0.8rem;
	border-radius: 0.6rem;
	border: 1px solid var(--border);
	background: var(--surface);
	color: var(--fg);
}
.grid-2 {
	display: grid;
	grid-template-columns: 1fr 120px;
	gap: 0.75rem;
}
.checkbox {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	color: var(--muted);
	font-size: 0.875rem;
}
.form-error {
	font-size: 0.8125rem;
	color: #f87171;
}
</style>
