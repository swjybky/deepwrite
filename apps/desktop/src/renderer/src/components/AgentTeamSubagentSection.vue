<script setup lang="ts">
import { useId } from "vue";
import { createScopedTranslator } from "../i18n";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.agentTeamSubagentSection");

defineProps<{
  count: number;
  limit: number;
  description: string;
  note: string;
  disabled: boolean;
  limitReached: boolean;
  readOnly?: boolean;
  hideLoadFromSkill?: boolean;
}>();

const emit = defineEmits<{ loadFromSkill: []; add: [] }>();
const titleId = useId();
</script>

<template>
  <section class="subagent-section" :aria-labelledby="titleId">
    <header class="section-header">
      <div class="section-heading">
        <h3 :id="titleId">
          {{ t("subagents") }}
          <span class="section-count">{{ count }} / {{ limit }}</span>
        </h3>
        <p>{{ description }}</p>
      </div>
      <div v-if="!readOnly" class="section-actions">
        <button
          v-if="!hideLoadFromSkill"
          type="button"
          class="secondary-button"
          :disabled="disabled || limitReached"
          @click="emit('loadFromSkill')"
        >
          <AppIcon name="wand" :size="15" />
          {{ t("loadFromSkillLibrary") }}
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="disabled || limitReached"
          @click="emit('add')"
        >
          <AppIcon name="plus" :size="15" />
          {{ t("addSubagent") }}
        </button>
      </div>
    </header>

    <details class="section-note">
      <summary>{{ t("howSubagentsRun") }}</summary>
      <p>{{ note }}</p>
    </details>

    <div v-if="!count" class="empty-team">
      <strong>{{ t("noSubagentsYet") }}</strong>
      <p>{{ t("afterYouAddSubagentsThePrimaryAgentUsesTheir") }}</p>
    </div>
    <div v-else class="subagent-list">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.subagent-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}
.section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
}
.section-heading {
  flex: 1 1 260px;
  min-width: 0;
}
.section-heading h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 1.07143rem;
  font-weight: 650;
}
.section-count {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-selected);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.section-heading p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
}
.section-actions {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.892857rem;
  font-weight: 600;
  cursor: pointer;
}
.secondary-button:hover:not(:disabled) {
  background: var(--surface-hover);
}
.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.section-note {
  color: var(--text-tertiary);
  font-size: 0.821429rem;
}
.section-note summary {
  width: fit-content;
  cursor: pointer;
  user-select: none;
}
.section-note summary:hover {
  color: var(--text-secondary);
}
.section-note p {
  margin: 8px 0 0;
  padding: 12px 14px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 10px;
  background: var(--surface-muted);
  color: var(--text-secondary);
  line-height: 1.65;
}
.empty-team {
  padding: 36px 20px;
  border: 1px dashed var(--theme-line);
  border-radius: 12px;
  color: var(--text-secondary);
  text-align: center;
}
.empty-team strong {
  display: block;
  margin-bottom: 5px;
  color: var(--text-primary);
}
.empty-team p {
  margin: 0;
  font-size: 0.892857rem;
}
.subagent-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
