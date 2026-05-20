<script setup lang="ts">
defineProps<{
	kind: "migrate" | "pending" | "measure";
}>();
</script>

<template>
	<span class="dock-icon-wrap" :class="`dock-icon-wrap--${kind}`" aria-hidden="true">
		<!-- Start migration: arrow -->
		<svg v-if="kind === 'migrate'" class="dock-icon" viewBox="0 0 24 24" fill="none">
			<path
				class="dock-icon-stem"
				d="M4 12h11"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
			<path
				class="dock-icon-head"
				d="M13 8l5 4-5 4"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>

		<!-- Almost there: link -->
		<svg v-else-if="kind === 'pending'" class="dock-icon" viewBox="0 0 24 24" fill="none">
			<path
				class="dock-icon-link-a"
				d="M9 12a3 3 0 0 1 0-4.24l1.17-1.17a3 3 0 0 1 4.24 0l.83.83"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
			<path
				class="dock-icon-link-b"
				d="M15 12a3 3 0 0 1 0 4.24l-1.17 1.17a3 3 0 0 1-4.24 0l-.83-.83"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</svg>

		<!-- Measuring: bars -->
		<svg v-else-if="kind === 'measure'" class="dock-icon" viewBox="0 0 24 24" fill="none">
			<path
				class="dock-icon-bar dock-icon-bar-1"
				d="M5 18V11"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
			<path
				class="dock-icon-bar dock-icon-bar-2"
				d="M12 18V6"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
			<path
				class="dock-icon-bar dock-icon-bar-3"
				d="M19 18v-8"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</svg>
	</span>
</template>

<style scoped>
.dock-icon-wrap {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.125rem;
	height: 1.125rem;
	flex-shrink: 0;
}

.dock-icon {
	width: 100%;
	height: 100%;
	display: block;
}

.dock-icon-stem,
.dock-icon-head,
.dock-icon-link-a,
.dock-icon-link-b,
.dock-icon-bar {
	transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
	transform-origin: center;
}
</style>
