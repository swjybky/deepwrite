<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  BUILTIN_SUBAGENT_NAMES,
  defaultBuiltinSubagentSettings,
  type BuiltinSubagentSettings
} from "@deepwrite/contracts/renderer";
import { useBuiltinSubagentSettings } from "../composables/useBuiltinSubagentSettings";

const props = defineProps<{
  settings: BuiltinSubagentSettings;
  disabled?: boolean;
}>();
const domains = ["skill", "material"] as const;
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
  <section class="builtin-managers" aria-label="内置管理子智能体">
    <header>
      <h2>内置管理子智能体</h2>
      <p>普通模式和团队模式共用，仅在你主动要求创建或修改绑定库内容时调用。</p>
    </header>
    <div class="manager-grid">
      <article v-for="domain in domains" :key="domain">
        <div class="manager-heading">
          <div class="manager-title">
            <h3>{{ BUILTIN_SUBAGENT_NAMES[domain] }}</h3>
            <span class="manager-status">
              <span
                class="status-dot"
                :class="{ 'is-enabled': settings[domain].enabled }"
                aria-hidden="true"
              />
              {{ settings[domain].enabled ? "已启用" : "已停用" }}
            </span>
          </div>
          <button
            :id="`builtin-${domain}-edit`"
            type="button"
            class="secondary-button"
            :aria-label="`编辑${BUILTIN_SUBAGENT_NAMES[domain]}`"
            :aria-expanded="editing === domain"
            :aria-controls="`builtin-${domain}-editor`"
            :disabled="disabled || saving || editing !== null"
            @click="startEditing(domain)"
          >
            {{ editing === domain ? "编辑中" : "编辑" }}
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
            启用此子智能体
          </label>
          <label :for="`builtin-${domain}-description`">调用描述</label>
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
              取消
            </button>
            <button
              type="submit"
              class="primary-button"
              :disabled="disabled || saving"
            >
              {{ saving ? "保存中…" : "保存" }}
            </button>
          </div>
        </form>
      </article>
    </div>
  </section>
</template>

<style scoped>
.builtin-managers {
  margin-bottom: 24px;
  color: var(--text-primary);
}
h2,
h3 {
  margin: 0;
  font-size: 1em;
}
p {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 0.875em;
  line-height: 1.6;
}
.manager-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  align-items: start;
  gap: 12px;
  margin-top: 14px;
}
article {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--theme-line);
  border-radius: 14px;
  background: var(--surface-raised);
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
  display: grid;
  gap: 8px;
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
  margin-top: 16px;
  padding-top: 16px;
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
  padding: 8px 12px;
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
  border-color: var(--text-primary);
  background: var(--text-primary);
  color: var(--surface-main);
}
:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
