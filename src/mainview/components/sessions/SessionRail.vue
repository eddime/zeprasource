<script setup lang="ts">
import SessionCard from "./SessionCard.vue";
import type { SessionCardModel } from "../../../shared/migration-sessions";

defineProps<{
	side: "left" | "right";
	sessions: SessionCardModel[];
	selectedId?: string | null;
}>();

const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
	<aside
		v-if="sessions.length > 0"
		class="session-rail"
		:class="`session-rail--${side}`"
		:aria-label="side === 'left' ? 'Active migrations' : 'Past migrations'"
	>
		<p class="session-rail-label">{{ side === "left" ? "Active" : "Past" }}</p>
		<ul
			class="session-rail-list"
			:class="{ 'session-rail-list--scroll': sessions.length > 3 }"
		>
			<li
				v-for="session in sessions"
				:key="session.id"
				class="session-rail-item"
			>
				<SessionCard
					:session="session"
					:selected="selectedId === session.id"
					@select="emit('select', $event)"
				/>
			</li>
		</ul>
	</aside>
</template>

<style scoped>
.session-rail {
	--rail-w: 12.25rem;
	--session-card-slot: 6.85rem;
	--session-card-gap: 0.5rem;
	position: absolute;
	top: 4rem;
	bottom: calc(var(--app-dock-h-hover) + 0.2rem);
	z-index: 2;
	width: var(--rail-w);
	pointer-events: auto;
	display: flex;
	flex-direction: column;
	gap: 0.45rem;
	min-height: 0;
}

.session-rail--left {
	left: max(0.65rem, calc(var(--site-padding-x, 1.25rem) - 0.35rem));
}

.session-rail--right {
	right: max(0.65rem, calc(var(--site-padding-x, 1.25rem) - 0.35rem));
}

.session-rail-label {
	margin: 0;
	padding: 0 0.15rem 0.3rem;
	font-size: 0.625rem;
	font-weight: 600;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--muted-light);
	line-height: 1;
}

.session-rail-item {
	flex-shrink: 0;
}

.session-rail-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: var(--session-card-gap);
	flex: 1;
	min-height: 0;
	overflow-x: hidden;
	overflow-y: visible;
}

.session-rail-list--scroll {
	overflow-y: scroll;
	overscroll-behavior: contain;
	padding-right: 0.35rem;
	scrollbar-width: thin;
	scrollbar-color: rgba(0, 0, 0, 0.28) rgba(0, 0, 0, 0.06);
}

.session-rail-list--scroll::-webkit-scrollbar {
	width: 5px;
}

.session-rail-list--scroll::-webkit-scrollbar-track {
	background: rgba(0, 0, 0, 0.05);
	border-radius: 999px;
}

.session-rail-list--scroll::-webkit-scrollbar-thumb {
	background: rgba(0, 0, 0, 0.22);
	border-radius: 999px;
}

.session-rail-list--scroll::-webkit-scrollbar-thumb:hover {
	background: rgba(0, 0, 0, 0.32);
}

@media (max-width: 900px) {
	.session-rail {
		display: none;
	}
}
</style>
