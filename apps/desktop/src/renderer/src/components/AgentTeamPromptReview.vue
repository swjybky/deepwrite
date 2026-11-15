<script setup lang="ts">
import { computed } from "vue";
import type {
  AgentTeamChangeReview,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import { buildAgentTextDiff } from "../utils/agentTextDiff";
import AgentEditProposalDiff from "./AgentEditProposalDiff.vue";
import {
  SCRIPT_PARENT_AGENTS,
  SHORT_PARENT_AGENT,
  SUBAGENT_AGENT_MODE_LABELS,
  SUBAGENT_WEB_SEARCH_LABELS
} from "./agentTeamSettingsMeta";

const t = createScopedTranslator("components.agentUserInputCard");
const props = defineProps<{
  review: AgentTeamChangeReview;
  requestId: string;
}>();

type Member = ShortAgentSubagentDefinition;
const parentLabel = (id: string) =>
  [SHORT_PARENT_AGENT, ...SCRIPT_PARENT_AGENTS].find((agent) => agent.id === id)
    ?.label ?? id;
const onOff = (value: boolean) => t(value ? "valueOn" : "valueOff");
type MessageKey = Parameters<typeof t>[0];
function modelText(
  member: Pick<
    Member,
    "modelMode" | "modelId" | "thinkingLevel" | "temperature"
  >
) {
  return [
    member.modelMode === "inherit" ? t("inheritModel") : member.modelId,
    member.modelMode === "inherit" ? member.modelId : undefined,
    member.thinkingLevel,
    member.temperature
  ]
    .filter((value) => value !== undefined)
    .join(" · ");
}
const FIELDS: [MessageKey, (member: Member) => string][] = [
  ["fieldName", (member) => member.name],
  ["fieldDescription", (member) => member.description],
  ["fieldEnabled", (member) => onOff(member.enabled)],
  ["fieldAgentMode", (member) => SUBAGENT_AGENT_MODE_LABELS[member.agentMode]],
  [
    "fieldWebSearch",
    (member) => SUBAGENT_WEB_SEARCH_LABELS[member.webSearchMode ?? "inherit"]
  ],
  ["fieldModel", modelText],
  ["fieldDraw", (member) => onOff(member.draw?.enabled ?? false)],
  [
    "fieldDrawCount",
    (member) =>
      member.draw
        ? `${member.draw.countMode ?? "fixed"} · ${member.draw.count}`
        : ""
  ],
  ["fieldDrawSelection", (member) => member.draw?.selection ?? ""],
  [
    "fieldEvaluator",
    (member) =>
      member.draw
        ? `${member.draw.evaluator.evaluationMethod ?? "llm"} · ${modelText(member.draw.evaluator)}`
        : ""
  ],
  ["fieldEvaluatorPrompt", (member) => member.draw?.evaluator.prompt ?? ""]
];

const changes = computed(() =>
  props.review.members.map((change) => {
    const { before, after } = change;
    const kind: MessageKey = !before
      ? "memberAdded"
      : !after
        ? "memberRemoved"
        : "memberUpdated";
    const rows = FIELDS.flatMap(([label, show]) => {
      const previous = before ? show(before) : "";
      const next = after ? show(after) : "";
      return previous === next ? [] : [{ label, previous, next }];
    });
    const prompt =
      before?.systemPrompt !== after?.systemPrompt
        ? {
            id: `${props.requestId}:${change.parentAgentId}:${change.memberId}`,
            ...buildAgentTextDiff(
              before?.systemPrompt ?? "",
              after?.systemPrompt ?? ""
            )
          }
        : undefined;
    return {
      key: `${change.parentAgentId}:${change.memberId}`,
      name: (after ?? before)!.name,
      parent: parentLabel(change.parentAgentId),
      kind,
      rows,
      prompt,
      previousPrompt: before?.systemPrompt,
      nextPrompt: after?.systemPrompt
    };
  })
);
</script>

<template>
  <section class="team-prompt-review" :aria-label="t('reviewTeamPrompt')">
    <p class="prompt-target">{{ review.teamName }}</p>
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
    <p v-if="review.parallelSubagents">
      {{
        t("parallelChange", {
          before: onOff(review.parallelSubagents.before),
          after: onOff(review.parallelSubagents.after)
        })
      }}
    </p>
    <article v-for="change in changes" :key="change.key" class="member-change">
      <p class="prompt-target">
        {{ t(change.kind) }} · {{ change.parent }} / {{ change.name }}
      </p>
      <dl v-if="change.rows.length">
        <template v-for="row in change.rows" :key="row.label">
          <dt>{{ t(row.label) }}</dt>
          <dd>
            <span v-if="row.previous" class="previous">{{ row.previous }}</span>
            <span v-if="row.previous && row.next"> → </span>
            <span>{{ row.next }}</span>
          </dd>
        </template>
      </dl>
      <template v-if="change.prompt">
        <p class="shared-scope">{{ t("fieldPrompt") }}</p>
        <AgentEditProposalDiff :proposal="change.prompt" inline />
        <details v-if="change.previousPrompt">
          <summary>{{ t("viewOriginalPrompt") }}</summary>
          <pre>{{ change.previousPrompt }}</pre>
        </details>
        <details v-if="change.nextPrompt">
          <summary>{{ t("viewProposedPrompt") }}</summary>
          <pre>{{ change.nextPrompt }}</pre>
        </details>
      </template>
    </article>
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
.shared-scope,
.previous {
  color: var(--text-secondary);
}
.previous {
  text-decoration: line-through;
}
.member-change {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-main);
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 0.4fr) minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0;
}
dt {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
}
summary {
  cursor: pointer;
}
</style>
