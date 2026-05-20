<script setup lang="ts">
withDefaults(
	defineProps<{
		variant?: "primary" | "secondary" | "ghost";
		size?: "sm" | "md" | "lg";
		disabled?: boolean;
		loading?: boolean;
		type?: "button" | "submit";
		block?: boolean;
	}>(),
	{
		variant: "primary",
		size: "md",
		disabled: false,
		loading: false,
		type: "button",
		block: false,
	},
);
</script>

<template>
	<button
		:type="type"
		class="btn"
		:class="[`v-${variant}`, `s-${size}`, { block }]"
		:disabled="disabled || loading"
	>
		<span v-if="loading" class="spin" />
		<slot />
	</button>
</template>

<style scoped>
.btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.4rem;
	border: none;
	border-radius: var(--radius-pill);
	font-weight: 600;
	cursor: pointer;
	transition: transform 0.15s ease, opacity 0.15s ease;
}
.btn:disabled {
	opacity: 0.35;
	cursor: not-allowed;
}
.btn:not(:disabled):active {
	transform: scale(0.97);
}
.v-primary {
	background: var(--fg);
	color: #fff;
}
.v-primary:hover:not(:disabled) {
	opacity: 0.88;
}
.v-secondary {
	background: var(--btn-secondary);
	color: var(--fg);
}
.v-secondary:hover:not(:disabled) {
	background: #e5e5e5;
}
.v-ghost {
	background: transparent;
	color: var(--muted);
}
.v-ghost:hover:not(:disabled) {
	color: var(--fg);
}
.s-sm {
	padding: 0.45rem 1rem;
	font-size: 0.8125rem;
}
.s-md {
	padding: 0.65rem 1.35rem;
	font-size: 0.875rem;
}
.s-lg {
	padding: 0.9rem 2rem;
	font-size: 0.95rem;
	min-width: 200px;
}
.block {
	width: 100%;
	max-width: 280px;
}
.spin {
	width: 0.85rem;
	height: 0.85rem;
	border: 2px solid rgba(255, 255, 255, 0.3);
	border-top-color: #fff;
	border-radius: 50%;
	animation: spin 0.6s linear infinite;
}
.v-secondary .spin {
	border-color: rgba(0, 0, 0, 0.15);
	border-top-color: var(--fg);
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>
