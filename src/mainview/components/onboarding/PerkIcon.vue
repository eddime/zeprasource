<script setup lang="ts">
export type PerkIconKind = "mac" | "direct" | "resume" | "folders" | "backup";

defineProps<{
	kind: PerkIconKind;
}>();
</script>

<template>
	<svg
		class="perk-icon-svg"
		viewBox="0 0 24 24"
		fill="none"
		aria-hidden="true"
		stroke="#000"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<!-- Local device + lock -->
		<template v-if="kind === 'mac'">
			<rect x="4" y="4" width="16" height="11" rx="1.5" />
			<path d="M2.5 15.5h19" />
			<path d="M8 18h8" />
			<rect x="10" y="8" width="4" height="3" rx="0.5" />
			<path d="M11 8V7a1 1 0 0 1 2 0v1" />
		</template>

		<!-- Cloud off — no relay -->
		<template v-else-if="kind === 'direct'">
			<path
				d="M7 17h9.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.8A3.5 3.5 0 0 0 7 17Z"
			/>
			<path d="m5.5 6.5 13 13" />
		</template>

		<!-- Resume / pick up where you left off -->
		<template v-else-if="kind === 'resume'">
			<path d="M4 12a8 8 0 0 1 13.5-5.8" />
			<path d="M17.5 4.5V9h-4.5" />
			<path d="M20 12a8 8 0 0 1-13.5 5.8" />
			<path d="M6.5 19.5V15H11" />
		</template>

		<!-- Local backup -->
		<template v-else-if="kind === 'backup'">
			<path d="M4 8.5V18a1.5 1.5 0 0 0 1.5 1.5H14A1.5 1.5 0 0 0 15.5 16.5V10.2L19.5 6H9L7 4H4.5A1.5 1.5 0 0 0 3 5.5V8" />
			<path d="M12 13v5" />
			<path d="M9.5 15.5 12 18l2.5-2.5" />
		</template>

		<!-- Folder + flag -->
		<template v-else>
			<path d="M4 8.5V18a1.5 1.5 0 0 0 1.5 1.5H18A1.5 1.5 0 0 0 19.5 18V9.5A1.5 1.5 0 0 0 18 8H11L9 6H5.5A1.5 1.5 0 0 0 4 7.5Z" />
			<path d="M15 6v7" />
			<path d="M15 6l2.25 1.35L15 8.7" />
		</template>
	</svg>
</template>

<style scoped>
.perk-icon-svg {
	width: 1.75rem;
	height: 1.75rem;
	display: block;
}
</style>
