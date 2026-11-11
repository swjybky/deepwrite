<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { formatModelProviderError } from "../i18n/errors";
import { computed } from "vue";
import {
  subagentRunDetailId,
  type AgentSubagentRun
} from "../types/conversation";
import {
  subagentProcessingDisplayItems,
  subagentRetryStatus,
  type SubagentProcessingDisplayItem
} from "./subagentRunPresentation";
import ConversationRunClock from "./ConversationRunClock.vue";
import ConversationWorkGroup from "./ConversationWorkGroup.vue";
import StreamedContent from "./StreamedContent.vue";

const t = createScopedTranslator("components.subagentRunList");

const props = defineProps<{ run: AgentSubagentRun }>();

function exportModelCalls(): void {
  const calls = (props.run.modelCalls ?? []).map((call) => ({
    requestId: call.requestId,
    sequence: call.sequence,
    requestedProvider: call.requestedProvider,
    requestedModel: call.requestedModel,
    responseModel: call.responseModel,
    responseModelEvidence: call.responseModelEvidence,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    durationMs: call.durationMs,
    status: call.status
  }));
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ schemaVersion: 1, calls }, null, 2)], {
      type: "application/json"
    })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "subagent-model-calls.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const summary = computed(() =>
  props.run.status === "error" && props.run.summary
    ? formatModelProviderError(props.run.summary)
    : props.run.summary
);
const errorMessage = computed(() =>
  props.run.errorMessage
    ? formatModelProviderError(props.run.errorMessage)
    : undefined
);

// Built once per change, reusing unchanged groups so a streaming child only
// re-renders the part that grew.
const items = computed<SubagentProcessingDisplayItem[]>((previous) =>
  subagentProcessingDisplayItems(props.run, previous)
);
</script>

<template>
  <div class="subagent-run-detail">
    <section v-if="run.modelCalls?.length" class="subagent-run-handoff">
      <strong>{{ t("modelCalls") }}</strong>
      <button
        type="button"
        class="dialog-secondary-button"
        @click="exportModelCalls"
      >
        {{ t("exportModelCalls") }}
      </button>
      <p>{{ t("modelCallEvidence") }}</p>
      <dl
        v-for="call in run.modelCalls"
        :key="call.requestId"
        class="model-call-record"
      >
        <dt>{{ t("requestModel") }}</dt>
        <dd>{{ call.requestedProvider }} / {{ call.requestedModel }}</dd>
        <dt>{{ t("callStatus") }}</dt>
        <dd>{{ t(call.status) }}</dd>
        <dt>{{ t("callStarted") }}</dt>
        <dd>{{ call.startedAt }}</dd>
        <dt>{{ t("callDuration") }}</dt>
        <dd>
          {{
            call.durationMs === undefined
              ? t("unknown")
              : `${call.durationMs} ms`
          }}
        </dd>
        <dt>{{ t("callIdentity") }}</dt>
        <dd>{{ call.requestId }}</dd>
      </dl>
    </section>
    <section class="subagent-run-handoff subagent-run-assigned-task">
      <strong>{{ t("taskAssignedByPrimaryAgent") }}</strong>
      <p>{{ run.task }}</p>
    </section>
    <section
      v-if="run.draw?.role === 'candidate' && run.draw.variant"
      class="subagent-run-handoff subagent-run-assigned-task"
    >
      <strong>{{ t("drawVariant") }}</strong>
      <p>{{ run.draw.variant }}</p>
    </section>
    <ConversationRunClock v-slot="{ now }" :active="run.status === 'running'">
      <div v-if="subagentRetryStatus(run, now)" class="subagent-run-waiting">
        {{ subagentRetryStatus(run, now) }}
      </div>
    </ConversationRunClock>
    <div
      v-if="items.length"
      class="subagent-processing-list"
      :aria-label="t('subagentExecution')"
    >
      <template v-for="item in items" :key="item.id">
        <ConversationWorkGroup
          v-if="item.type === 'work-group'"
          :item="item"
          :streaming="run.status === 'running'"
          :detail-id-prefix="subagentRunDetailId(run)"
        />
        <div
          v-else-if="item.type === 'response'"
          class="processing-step processing-response subagent-processing-response"
        >
          <StreamedContent
            :content="item.content"
            format="markdown"
            :streaming="run.status === 'running'"
          />
        </div>
      </template>
    </div>
    <div v-else-if="run.status === 'running'" class="subagent-run-waiting">
      {{ t("startingIndependentContextAndReceivingEvents") }}
    </div>

    <section
      v-if="summary || errorMessage"
      class="subagent-run-handoff"
      :class="{ 'is-error': run.status === 'error' }"
    >
      <strong>{{
        run.status === "completed" ? t("handoffSummary") : t("completionNotes")
      }}</strong>
      <StreamedContent v-if="summary" :content="summary" format="markdown" />
      <p v-if="errorMessage && !summary?.includes(errorMessage)">
        {{ errorMessage }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.model-call-record {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.4em 1em;
  padding-block: 0.8em;
  border-top: 1px solid var(--theme-line-soft);
}
.model-call-record dt {
  color: var(--text-secondary);
}
.model-call-record dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
