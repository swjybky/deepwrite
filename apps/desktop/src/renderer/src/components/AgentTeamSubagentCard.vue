<script setup lang="ts">
import {
  activeSubagentDraw,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import AppIcon from "./AppIcon.vue";
import { SUBAGENT_AGENT_MODE_LABELS } from "./agentTeamSettingsMeta";

const t = createScopedTranslator("components.agentTeamSubagentCard");

defineProps<{
  subagent: ShortAgentSubagentDefinition;
  editing: boolean;
  disabled: boolean;
  duplicateDisabled: boolean;
  modelSummary: string;
}>();

const emit = defineEmits<{
  toggle: [enabled: boolean];
  edit: [];
  duplicate: [];
  remove: [];
}>();
</script>

<template>
  <article class="subagent-card" :class="{ 'is-editing': editing }">
    <header class="subagent-summary">
      <div
        class="subagent-copy"
        :class="{ 'is-disabled': !subagent.enabled }"
        @click="!disabled && emit('edit')"
      >
        <span class="subagent-title-row">
          <strong>{{ subagent.name || t("untitledSubagent") }}</strong>
          <span v-if="!subagent.enabled" class="state-badge">{{
            t("disabled")
          }}</span>
          <span v-if="subagent.agentMode !== 'standard'" class="model-badge">{{
            SUBAGENT_AGENT_MODE_LABELS[subagent.agentMode]
          }}</span>
          <span
            v-if="
              subagent.webSearchMode === 'on' &&
              subagent.agentMode !== 'pure-bare'
            "
            class="model-badge"
            >{{ t("webSearchBadge") }}</span
          >
          <span v-if="activeSubagentDraw(subagent)" class="model-badge">{{
            activeSubagentDraw(subagent)!.countMode === "auto"
              ? t("drawBadgeAuto")
              : t("drawBadge", { arg0: activeSubagentDraw(subagent)!.count })
          }}</span>
          <span class="model-badge">{{ modelSummary }}</span>
        </span>
        <span class="subagent-description">{{
          subagent.description ||
          t("describeItsCapabilitiesSoThePrimaryAgentKnowsWhen")
        }}</span>
      </div>
      <div class="subagent-controls">
        <AgentTeamSwitch
          :model-value="subagent.enabled"
          :disabled="disabled"
          :label="
            t('valueEnabledStatus', { arg0: subagent.name || t('subagent') })
          "
          :title="subagent.enabled ? t('disable') : t('enable')"
          @update:model-value="emit('toggle', $event)"
        />
        <div class="subagent-actions">
          <button
            type="button"
            class="icon-button"
            :disabled="disabled"
            :aria-label="t('editValue', { arg0: subagent.name })"
            :aria-expanded="editing"
            :title="t('edit')"
            @click="emit('edit')"
          >
            <AppIcon name="edit" :size="15" />
          </button>
          <button
            type="button"
            class="icon-button"
            :disabled="disabled || duplicateDisabled"
            :aria-label="t('duplicateValue', { arg0: subagent.name })"
            :title="t('duplicate')"
            @click="emit('duplicate')"
          >
            <AppIcon name="copy" :size="15" />
          </button>
          <button
            type="button"
            class="icon-button is-danger"
            :disabled="disabled"
            :aria-label="t('deleteValue', { arg0: subagent.name })"
            :title="t('delete')"
            @click="emit('remove')"
          >
            <AppIcon name="trash" :size="15" />
          </button>
        </div>
      </div>
    </header>
    <slot v-if="editing" />
  </article>
</template>

<style scoped>
.subagent-card {
  overflow: hidden;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}
.subagent-card.is-editing {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.subagent-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding: 12px 12px 12px 16px;
}
.subagent-copy {
  display: grid;
  flex: 1 1 240px;
  gap: 3px;
  min-width: 0;
  cursor: pointer;
}
.subagent-copy.is-disabled > * {
  opacity: 0.62;
}
.subagent-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-width: 0;
}
.subagent-title-row strong {
  min-width: 0;
  overflow: hidden;
  font-size: 1rem;
  font-weight: 630;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subagent-title-row .state-badge,
.subagent-title-row .model-badge {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-selected);
  color: var(--text-secondary);
  font-size: 0.714286rem;
  font-weight: 600;
}
.subagent-title-row .model-badge {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subagent-title-row .state-badge {
  color: var(--text-tertiary);
}
.subagent-description {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subagent-actions {
  display: flex;
  flex: none;
  gap: 2px;
}
.subagent-controls {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.icon-button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.icon-button.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger, #d65353) 12%, transparent);
  color: var(--danger, #d65353);
}
.icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.icon-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
  outline-offset: 2px;
}
</style>
