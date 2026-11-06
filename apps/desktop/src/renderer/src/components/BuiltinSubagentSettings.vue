<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { nextTick, ref } from "vue";
import {
  defaultBuiltinSubagentSettings,
  type BuiltinSubagentSettings
} from "@deepwrite/contracts/renderer";
import { useBuiltinSubagentSettings } from "../composables/useBuiltinSubagentSettings";

const t = createScopedTranslator("components.builtinSubagentSettings");

const BUILTIN_SUBAGENT_NAMES = {
  get skill() {
    return t("skillManager");
  },
  get material() {
    return t("materialManager");
  },
  get team() {
    return t("teamManager");
  }
};

const props = defineProps<{
  settings: BuiltinSubagentSettings;
  disabled?: boolean;
}>();
const domains = ["skill", "material", "team"] as const;
type Domain = (typeof domains)[number];
const editing = ref<Domain | null>(null);
const draft = ref(defaultBuiltinSubagentSettings());
const { saving, save } = useBuiltinSubagentSettings();

async function startEditing(domain: Domain): Promise<void> {
  draft.value[domain] = { ...props.settings[domain] };
  editing.value = domain;
  await nextTick();
  document.getElementById(`builtin-${domain}-description`)?.focus();
}

async function closeEditor(domain: Domain): Promise<void> {
  editing.value = null;
  await nextTick();
  document.getElementById(`builtin-${domain}-edit`)?.focus();
}

async function saveDomain(domain: Domain): Promise<void> {
  const saved = await save({
    ...props.settings,
    [domain]: { ...draft.value[domain] }
  });
  if (saved) await closeEditor(domain);
}
</script>

<template>
  <section
    class="builtin-managers"
    :aria-label="t('builtInManagementSubagents')"
  >
    <header>
      <h3>
        {{ t("builtInManagementSubagents") }}
      </h3>
      <p>
        {{ t("sharedByStandardAndTeamModesCalledOnlyWhen") }}
      </p>
    </header>
    <div class="manager-list">
      <article v-for="domain in domains" :key="domain">
        <div class="manager-heading">
          <div class="manager-title">
            <h4>{{ BUILTIN_SUBAGENT_NAMES[domain] }}</h4>
            <span class="manager-status">
              <span
                class="status-dot"
                :class="{ 'is-enabled': settings[domain].enabled }"
                aria-hidden="true"
              />
              {{ settings[domain].enabled ? t("enabled") : t("disabled") }}
            </span>
          </div>
          <button
            :id="`builtin-${domain}-edit`"
            type="button"
            class="secondary-button"
            :aria-label="
              t('editValue', {
                arg0: BUILTIN_SUBAGENT_NAMES[domain]
              })
            "
            :aria-expanded="editing === domain"
            :aria-controls="`builtin-${domain}-editor`"
            :disabled="disabled || saving || editing !== null"
            @click="startEditing(domain)"
          >
            {{ editing === domain ? t("editing") : t("edit") }}
          </button>
        </div>
        <form
          v-if="editing === domain"
          :id="`builtin-${domain}-editor`"
          class="manager-editor"
          @submit.prevent="saveDomain(domain)"
        >
          <label class="enabled-option">
            <input
              v-model="draft[domain].enabled"
              type="checkbox"
              :disabled="disabled || saving"
            />
            {{ t("enableThisSubagent") }}
          </label>
          <label :for="`builtin-${domain}-description`">{{
            t("invocationDescription")
          }}</label>
          <textarea
            :id="`builtin-${domain}-description`"
            v-model="draft[domain].description"
            rows="5"
            maxlength="1000"
            :disabled="disabled || saving"
          />
          <div class="editor-actions">
            <button
              type="button"
              class="secondary-button"
              :disabled="saving"
              @click="closeEditor(domain)"
            >
              {{ t("cancel") }}
            </button>
            <button
              type="submit"
              class="primary-button"
              :disabled="disabled || saving"
            >
              {{ saving ? t("saving") : t("save") }}
            </button>
          </div>
        </form>
      </article>
    </div>
  </section>
</template>

<style scoped>
.builtin-managers {
  color: var(--text-primary);
}
h3,
h4 {
  margin: 0;
}
h3 {
  font-size: 1.07143rem;
  font-weight: 650;
}
h4 {
  font-size: 0.928571rem;
  font-weight: 620;
}
p {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
}
.manager-list {
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
}
article {
  min-width: 0;
  padding: 14px 18px;
}
article + article {
  border-top: 1px solid var(--theme-line-soft);
}
.manager-heading,
.editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.manager-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.manager-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 0.8125em;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.status-dot.is-enabled {
  background: var(--accent);
}
.manager-editor {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--theme-line-soft);
}
label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.875em;
}
.enabled-option {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
input {
  margin: 0;
  accent-color: var(--accent);
}
textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
  min-height: 8em;
  border: 1px solid var(--theme-line);
  border-radius: 8px;
  padding: 10px;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
  line-height: 1.6;
}
textarea:focus-visible,
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.editor-actions {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
button {
  flex-shrink: 0;
  padding: 7px 12px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875em;
  cursor: pointer;
}
.secondary-button:hover:not(:disabled) {
  background: var(--surface-hover);
}
.primary-button {
  border-color: var(--neutral-solid);
  background: var(--neutral-solid);
  color: var(--accent-contrast, #fff);
}
:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
