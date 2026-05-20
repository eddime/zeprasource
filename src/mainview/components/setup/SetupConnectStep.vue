<script setup lang="ts">
import { computed } from "vue";
import type { MailboxCredentials } from "../../../shared/types";
import SetupStepHero from "./SetupStepHero.vue";
import MailboxCard from "../mailbox/MailboxCard.vue";
import MailboxFlowBridge from "../mailbox/MailboxFlowBridge.vue";
import LocalTestServersPanel from "../mailbox/LocalTestServersPanel.vue";
import AppDock from "../ui/AppDock.vue";

const source = defineModel<MailboxCredentials>("source", { required: true });
const destination = defineModel<MailboxCredentials>("destination", { required: true });

const props = defineProps<{
	subline: string;
	sourceValidated: boolean;
	destValidated: boolean;
	testingSource: boolean;
	testingDest: boolean;
	sourceTestError: string | null;
	destTestError: string | null;
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
	continue: [];
}>();

const stepsComplete = computed(
	() => props.sourceValidated && props.destValidated,
);

const ctaLabel = computed(() => (stepsComplete.value ? "Choose folders" : "Almost there"));
</script>

<template>
	<div class="setup-connect">
		<div class="setup-scroll">
		<SetupStepHero
			eyebrow="Step 1 of 2 · Connect"
			title="Connect your mailboxes"
			:subline="subline"
			show-back
			@back="emit('back')"
		/>

		<LocalTestServersPanel
			class="test-panel"
			@apply-source="emit('applySource')"
			@apply-dest="emit('applyDest')"
			@apply-cloud="emit('applyCloud')"
		/>

		<div class="mailbox-stage">
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

			<MailboxFlowBridge
				:source-ready="sourceValidated"
				:dest-ready="destValidated"
			/>

			<MailboxCard
				v-model:credentials="destination"
				class="mailbox-card mailbox-card--to"
				role="to"
				title="To"
				subtitle="Where your mail should land"
				:validated="destValidated"
				:testing="testingDest"
				:error="destTestError"
				@verify="emit('verifyDest')"
				@credentials-edited="emit('credentialsEditedDest')"
			/>
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

.mailbox-stage {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	gap: 0.65rem;
	align-items: stretch;
}

.mailbox-card {
	min-height: 0;
	overflow: hidden;
}

</style>
