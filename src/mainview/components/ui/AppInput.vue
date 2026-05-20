<script setup lang="ts">
defineProps<{
	modelValue: string | number;
	label?: string;
	type?: string;
	placeholder?: string;
	error?: string;
	compact?: boolean;
}>();

defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
	<label class="field" :class="{ compact }">
		<span v-if="label" class="lbl">{{ label }}</span>
		<input
			:type="type ?? 'text'"
			class="inp"
			:class="{ err: error }"
			:value="modelValue"
			:placeholder="placeholder"
			autocomplete="off"
			@input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
		/>
		<span v-if="error" class="err">{{ error }}</span>
	</label>
</template>

<style scoped>
.field {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
}
.lbl {
	font-size: 0.7rem;
	font-weight: 600;
	color: var(--muted);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}
.inp {
	width: 100%;
	padding: 0.65rem 0.85rem;
	border-radius: 12px;
	border: 1px solid var(--border);
	background: var(--bg);
	color: var(--fg);
	font-size: 0.875rem;
}
.inp:focus {
	outline: none;
	border-color: var(--fg);
}
.inp.err {
	border-color: #ef4444;
}
.err {
	font-size: 0.72rem;
	color: #ef4444;
}

.field.compact {
	gap: 0.2rem;
}

.field.compact .lbl {
	font-size: 0.62rem;
	letter-spacing: 0.05em;
}

.field.compact .inp {
	padding: 0.42rem 0.6rem;
	font-size: 0.8125rem;
	border-radius: 10px;
}

.field.compact .err {
	font-size: 0.65rem;
}
</style>
