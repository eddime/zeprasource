<script setup lang="ts">
import { computed } from "vue";
import type { MailboxCredentials } from "../../../shared/types";
import SetupStepHero from "./SetupStepHero.vue";
import MailboxCard from "../mailbox/MailboxCard.vue";
import MailboxFlowBridge from "../mailbox/MailboxFlowBridge.vue";
import LocalTestServersPanel from "../mailbox/LocalTestServersPanel.vue";
import DestinationModePicker, { type ConnectTarget } from "./DestinationModePicker.vue";
import BackupTargetCard from "./BackupTargetCard.vue";
import AppDock from "../ui/AppDock.vue";

const source = defineModel<MailboxCredentials>("source", { required: true });
const destination = defineModel<MailboxCredentials>("destination", { required: true });
const connectTarget = defineModel<ConnectTarget | null>("connectTarget", { default: null });
const backupParentDir = defineModel<string>("backupParentDir", { required: true });

const props = defineProps<{
	subline: string;
	sourceValidated: boolean;
	destValidated: boolean;
	backupReady: boolean;
	testingSource: boolean;
	testingDest: boolean;
	sourceTestError: string | null;
	destTestError: string | null;
	backupDiskError: string | null;
	pickingBackupDir: boolean;
}>();

const emit = defineEmits<{
	back: [];
	verifySource: [];
	verifyDest: [];
	credentialsEditedSource: [];
	credentialsEditedDest: [];
	applySource: [];
	applyDest: [];
	applyCloud: [];
	pickBackupDir: [];
	continue: [];
}>();

const layoutExpanded = computed(() => props.sourceValidated);

const showTargetPicker = computed(
	() => props.sourceValidated && connectTarget.value === null,
);
const showMailTarget = computed(() => connectTarget.value === "mail");
const showBackupTarget = computed(() => connectTarget.value === "backup");

const bridgeDestReady = computed(() => {
	if (showBackupTarget.value) return props.backupReady;
	if (showTargetPicker.value) return false;
	return props.destValidated;
});

const stepsComplete = computed(() => {
	if (!props.sourceValidated) return false;
	if (connectTarget.value === "mail") return props.destValidated;
	if (connectTarget.value === "backup") return props.backupReady;
	return false;
});

const ctaLabel = computed(() => {
	if (!props.sourceValidated) return "Waiting for connection";
	if (showTargetPicker.value) return "Choose mail or backup";
	if (!stepsComplete.value) {
		return connectTarget.value === "backup"
			? "Choose a save folder"
			: "Waiting for connection";
	}
	if (connectTarget.value === "backup") return "Let's backup";
	return "Start migration";
});

const heroTitle = computed(() =>
	layoutExpanded.value ? "Connect your mailboxes" : "Connect your mailbox",
);

const heroSubline = computed(() => {
	if (!layoutExpanded.value) return props.subline;
	if (showTargetPicker.value) {
		return "Where should your mail go — another mailbox or a local backup on your Mac?";
	}
	if (showBackupTarget.value) {
		return "Pick a folder on your Mac, then choose which folders to back up.";
	}
	return props.subline;
});
</script>

<template>
	<div class="setup-connect">
		<div class="setup-scroll">
			<SetupStepHero
				eyebrow="Step 1 of 2 · Connect"
				:title="heroTitle"
				:subline="heroSubline"
				show-back
				@back="emit('back')"
			/>

			<LocalTestServersPanel
				class="test-panel"
				@apply-source="emit('applySource')"
				@apply-dest="emit('applyDest')"
				@apply-cloud="emit('applyCloud')"
			/>

			<div
				class="mailbox-stage"
				:class="{ 'mailbox-stage--expanded': layoutExpanded }"
			>
				<MailboxCard
					v-model:credentials="source"
					class="mailbox-card mailbox-card--from"
					role="from"
					title="From"
					subtitle="Where your mail lives today"
					:validated="sourceValidated"
					:testing="testingSource"
					:error="sourceTestError"
					@verify="emit('verifySource')"
					@credentials-edited="emit('credentialsEditedSource')"
				/>

				<Transition name="stage-reveal">
					<MailboxFlowBridge
						v-if="layoutExpanded"
						key="bridge"
						:source-ready="sourceValidated"
						:dest-ready="bridgeDestReady"
					/>
				</Transition>

				<Transition name="stage-reveal">
					<div v-if="layoutExpanded" key="dest" class="mailbox-dest-slot">
						<Transition name="dest-swap" mode="out-in">
							<DestinationModePicker
								v-if="showTargetPicker"
								key="picker"
								v-model="connectTarget"
								class="mailbox-card"
							/>

							<MailboxCard
								v-else-if="showMailTarget"
								key="mail"
								v-model:credentials="destination"
								class="mailbox-card"
								role="to"
								title="To"
								subtitle="Where your mail should land"
								:validated="destValidated"
								:testing="testingDest"
								:error="destTestError"
								@verify="emit('verifyDest')"
								@credentials-edited="emit('credentialsEditedDest')"
							/>

							<BackupTargetCard
								v-else-if="showBackupTarget"
								key="backup"
								v-model:backup-parent-dir="backupParentDir"
								class="mailbox-card"
								:ready="backupReady"
								:picking="pickingBackupDir"
								:disk-error="backupDiskError"
								@pick-dir="emit('pickBackupDir')"
							/>
						</Transition>
					</div>
				</Transition>
			</div>
		</div>

		<AppDock :label="ctaLabel" :disabled="!stepsComplete" @action="emit('continue')" />
	</div>
</template>

<style scoped>
.setup-connect {
	height: 100%;
	width: 100%;
	align-self: stretch;
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.setup-scroll {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 0.65rem;
	width: 100%;
	max-width: 100%;
	margin: 0 auto;
	padding: 0 0 var(--app-dock-h-hover);
	scrollbar-width: thin;
}

.test-panel {
	flex-shrink: 0;
}

/* Same column widths as the original connect step (1fr · bridge · 1fr). */
.mailbox-stage {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	justify-items: center;
	align-items: stretch;
	transition: grid-template-columns 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.mailbox-stage--expanded {
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	justify-items: stretch;
	gap: 0.65rem;
}

.mailbox-dest-slot {
	min-width: 0;
	min-height: 0;
	height: 100%;
}

.mailbox-stage:not(.mailbox-stage--expanded) .mailbox-card--from {
	width: 100%;
	max-width: 26rem;
}

.mailbox-card,
.mailbox-slot {
	min-height: 0;
	overflow: hidden;
}

/* Bridge + To slot slide in together as From moves left. */
.stage-reveal-enter-active {
	transition:
		opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1),
		transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.stage-reveal-leave-active {
	transition:
		opacity 0.28s ease,
		transform 0.32s ease;
}

.stage-reveal-enter-from,
.stage-reveal-leave-to {
	opacity: 0;
	transform: translateX(1rem);
}

.dest-swap-enter-active,
.dest-swap-leave-active {
	transition:
		opacity 0.22s ease,
		transform 0.22s ease;
}

.dest-swap-enter-from,
.dest-swap-leave-to {
	opacity: 0;
	transform: translateY(0.35rem);
}

@media (prefers-reduced-motion: reduce) {
	.mailbox-stage,
	.stage-reveal-enter-active,
	.stage-reveal-leave-active,
	.dest-swap-enter-active,
	.dest-swap-leave-active {
		transition: none;
	}

	.stage-reveal-enter-from,
	.stage-reveal-leave-to,
	.dest-swap-enter-from,
	.dest-swap-leave-to {
		transform: none;
	}
}
</style>
