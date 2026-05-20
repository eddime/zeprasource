<script setup lang="ts">
defineProps<{ compact?: boolean }>();
</script>

<template>
	<ul class="trust" :class="{ compact }">
		<li>
			<span class="dot" aria-hidden="true" />
			All data stays on your computer
		</li>
		<li>
			<span class="dot" aria-hidden="true" />
			No cloud processing
		</li>
		<li>
			<span class="dot" aria-hidden="true" />
			Secure local migration
		</li>
	</ul>
</template>

<style scoped>
.trust {
	display: flex;
	flex-direction: column;
	gap: 0.55rem;
	list-style: none;
	padding: 0;
	margin: 0;
}
.trust.compact {
	flex-direction: row;
	flex-wrap: wrap;
	gap: 0.75rem 1.25rem;
}
.trust li {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-size: 0.8125rem;
	color: var(--muted);
}
.dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--accent);
	box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 60%, transparent);
}
</style>
