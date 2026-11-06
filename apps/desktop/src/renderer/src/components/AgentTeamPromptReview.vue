<script setup lang="ts">
import { computed } from "vue";
import type { AgentTeamPromptReview } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import { buildAgentTextDiff } from "../utils/agentTextDiff";
import AgentEditProposalDiff from "./AgentEditProposalDiff.vue";

const t = createScopedTranslator("components.agentUserInputCard");
const props = defineProps<{
  review: AgentTeamPromptReview;
  requestId: string;
}>();
const diff = computed(() => ({
  id: props.requestId,
  ...buildAgentTextDiff(props.review.previousPrompt, props.review.prompt)
}));
</script>

<template>
  <section class="team-prompt-review" :aria-label="t('reviewTeamPrompt')">
    <p class="prompt-target">{{ review.teamName }} / {{ review.memberName }}</p>
    <p>{{ review.summary }}</p>
    <p class="shared-scope">
      {{
        t(
          review.enabledAsDefault
            ? "promptAppliesToDefaultWorks"
            : "promptAppliesToBoundBooks",
          { count: review.boundBookCount }
        )
      }}
    </p>
    <AgentEditProposalDiff :proposal="diff" inline />
    <details>
      <summary>{{ t("viewOriginalPrompt") }}</summary>
      <pre>{{ review.previousPrompt }}</pre>
    </details>
    <details>
      <summary>{{ t("viewProposedPrompt") }}</summary>
      <pre>{{ review.prompt }}</pre>
    </details>
  </section>
</template>

<style scoped>
.team-prompt-review {
  display: grid;
  gap: 10px;
  min-width: 0;
  color: var(--text-primary);
}
p {
  margin: 0;
}
.prompt-target {
  font-weight: 650;
}
.shared-scope {
  color: var(--text-secondary);
}
details {
  min-width: 0;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-main);
}
summary {
  padding: 10px;
  cursor: pointer;
}
pre {
  margin: 0;
  padding: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: 1.6;
}
</style>
