<script setup lang="ts">
import {
  LEARNING_IMITATION_STAGE_DESCRIPTIONS,
  LEARNING_IMITATION_STAGE_IDS,
  LEARNING_IMITATION_STAGE_LABELS,
  type LearningImitationPromptInput,
  type LearningImitationSettings,
  type LearningImitationSettingsInput,
  type LearningImitationStageId
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  settings: LearningImitationSettings | null;
  loading: boolean;
  saving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  save: [settings: LearningImitationSettingsInput];
  reset: [stageId: LearningImitationStageId];
}>();

const activeStageId = ref<LearningImitationStageId>(
  LEARNING_IMITATION_STAGE_IDS[0]
);
const draftPrompts = ref<LearningImitationPromptInput[]>([]);
const RUNTIME_PLACEHOLDER_NAMES = [
  "STAGE_ID",
  "STAGE_LABEL",
  "DOCUMENT_COUNT",
  "DOCUMENTS_SUMMARY",
  "CURRENT_RESULT"
] as const;

watch(
  () => props.settings,
  (settings) => {
    draftPrompts.value = settings
      ? settings.prompts.map(({ id, systemPrompt }) => ({ id, systemPrompt }))
      : [];
  },
  { immediate: true, deep: true }
);

const activeDraft = computed(() =>
  draftPrompts.value.find((prompt) => prompt.id === activeStageId.value)
);

const activeSavedPrompt = computed(() =>
  props.settings?.prompts.find((prompt) => prompt.id === activeStageId.value)
);

const formDisabled = computed(
  () => props.loading || props.saving || !props.runtimeAvailable
);

const activeHasUnsavedChanges = computed(
  () =>
    activeDraft.value?.systemPrompt !== activeSavedPrompt.value?.systemPrompt
);

function selectStage(stageId: LearningImitationStageId): void {
  activeStageId.value = stageId;
}

function updateActivePrompt(event: Event): void {
  if (!activeDraft.value || formDisabled.value) return;
  activeDraft.value.systemPrompt = (event.target as HTMLTextAreaElement).value;
}

function saveSettings(): void {
  if (
    formDisabled.value ||
    draftPrompts.value.length !== LEARNING_IMITATION_STAGE_IDS.length
  ) {
    return;
  }
  if (draftPrompts.value.some((prompt) => !prompt.systemPrompt.trim())) {
    uiMessage.warning("三个学习阶段的系统提示词都不能为空");
    return;
  }
  emit("save", {
    prompts: LEARNING_IMITATION_STAGE_IDS.map((id) => ({
      id,
      systemPrompt:
        draftPrompts.value.find((prompt) => prompt.id === id)!.systemPrompt
    }))
  });
}

function resetActivePrompt(): void {
  if (formDisabled.value) return;
  emit("reset", activeStageId.value);
}

function formatRuntimePlaceholder(name: string): string {
  return `{{${name}}}`;
}
</script>

<template>
  <section class="learning-settings" aria-labelledby="learning-settings-title">
    <header class="panel-header">
      <div>
        <span class="panel-kicker">学习仿写</span>
        <h2 id="learning-settings-title">学习仿写提示词</h2>
        <p>分别配置素材拆分、剧情学习和文风学习三个阶段的系统提示词。</p>
        <p v-if="!runtimeAvailable" class="runtime-note">
          当前环境仅支持查看；保存和恢复默认提示词需要使用 DeepWrite 桌面端。
        </p>
      </div>
    </header>

    <div v-if="loading" class="panel-state" aria-live="polite">
      正在加载学习仿写设置…
    </div>
    <div v-else-if="!settings || !activeDraft" class="panel-state">
      暂无可用的学习仿写设置。
    </div>

    <div v-else class="settings-layout">
      <nav class="stage-nav" aria-label="学习仿写阶段">
        <button
          v-for="stageId in LEARNING_IMITATION_STAGE_IDS"
          :key="stageId"
          type="button"
          class="stage-nav-item"
          :class="{ 'is-active': activeStageId === stageId }"
          :aria-current="activeStageId === stageId ? 'page' : undefined"
          @click="selectStage(stageId)"
        >
          <strong>{{ LEARNING_IMITATION_STAGE_LABELS[stageId] }}</strong>
          <small>{{ LEARNING_IMITATION_STAGE_DESCRIPTIONS[stageId] }}</small>
        </button>
      </nav>

      <div class="prompt-editor">
        <header class="stage-header">
          <div>
            <span>当前阶段</span>
            <h3>{{ LEARNING_IMITATION_STAGE_LABELS[activeStageId] }}</h3>
            <p>{{ LEARNING_IMITATION_STAGE_DESCRIPTIONS[activeStageId] }}</p>
          </div>
          <span
            v-if="activeHasUnsavedChanges"
            class="prompt-state is-unsaved"
          >
            未保存
          </span>
          <span
            v-else-if="activeSavedPrompt?.customized"
            class="prompt-state"
          >
            已自定义
          </span>
        </header>

        <section class="prompt-card">
          <div class="prompt-card-heading">
            <div>
              <h4>系统提示词</h4>
              <p>文档摘要和当前学习结果会在每次运行时自动补充。</p>
            </div>
            <span>{{ activeDraft.systemPrompt.length }} 字符</span>
          </div>
          <textarea
            :value="activeDraft.systemPrompt"
            :disabled="formDisabled"
            spellcheck="false"
            :aria-label="`${LEARNING_IMITATION_STAGE_LABELS[activeStageId]}系统提示词`"
            placeholder="输入当前学习阶段的系统提示词…"
            @input="updateActivePrompt"
          />
          <div class="placeholder-guide">
            <strong>运行时占位符</strong>
            <div class="placeholder-list">
              <code v-for="name in RUNTIME_PLACEHOLDER_NAMES" :key="name">
                {{ formatRuntimePlaceholder(name) }}
              </code>
            </div>
            <p>保存时会保留原样，运行该阶段时再注入实际文档与结果。</p>
          </div>
        </section>

        <footer class="panel-actions">
          <button
            type="button"
            class="secondary-button"
            :disabled="formDisabled"
            @click="resetActivePrompt"
          >
            <AppIcon name="history" :size="15" />
            恢复当前阶段默认
          </button>
          <button
            type="button"
            class="primary-button"
            :disabled="formDisabled"
            @click="saveSettings"
          >
            <AppIcon name="save" :size="15" />
            {{ saving ? "保存中…" : "保存学习仿写设置" }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<style scoped>
.learning-settings {
  width: min(100%, 980px);
  color: var(--text-primary);
}

.panel-header {
  margin-bottom: 20px;
}

.panel-kicker,
.stage-header > div > span {
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.panel-header h2 {
  margin: 4px 0 5px;
  font-size: 1.57143rem;
  font-weight: 650;
}

.panel-header p,
.stage-header p,
.prompt-card-heading p,
.placeholder-guide p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.892857rem;
  line-height: 1.55;
}

.runtime-note {
  margin-top: 5px !important;
  color: var(--warning-text, #8a6731) !important;
}

.panel-state {
  padding: 48px 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: center;
}

.settings-layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.stage-nav {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-muted);
}

.stage-nav-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 66px;
  padding: 9px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.stage-nav-item:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.stage-nav-item.is-active {
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
}

.stage-nav-item strong {
  font-size: 0.964286rem;
  font-weight: 620;
}

.stage-nav-item small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.prompt-editor {
  min-width: 0;
}

.stage-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 14px;
  padding: 2px 2px 0;
}

.stage-header h3 {
  margin: 3px 0 4px;
  font-size: 1.28571rem;
  font-weight: 640;
}

.prompt-state {
  flex: none;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.785714rem;
  font-weight: 620;
}

.prompt-state.is-unsaved {
  background: var(--surface-selected);
  color: var(--text-secondary);
}

.prompt-card {
  overflow: hidden;
  border: 1px solid var(--theme-line-soft);
  border-radius: 13px;
  background: var(--surface-raised);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.035);
}

.prompt-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 15px 17px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
}

.prompt-card-heading h4 {
  margin: 0 0 3px;
  font-size: 1rem;
  font-weight: 620;
}

.prompt-card-heading > span {
  flex: none;
  color: var(--text-tertiary);
  font-size: 0.821429rem;
}

.prompt-card textarea {
  display: block;
  width: 100%;
  min-height: 420px;
  padding: 16px 17px;
  resize: vertical;
  border: 0;
  outline: none;
  box-sizing: border-box;
  background: var(--surface-main);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.65;
}

.prompt-card textarea:focus {
  box-shadow: inset 0 0 0 2px var(--accent-soft);
}

.prompt-card textarea:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.placeholder-guide {
  padding: 13px 17px 15px;
  border-top: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
}

.placeholder-guide > strong {
  display: block;
  margin-bottom: 8px;
  font-size: 0.857143rem;
  font-weight: 620;
}

.placeholder-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.placeholder-list code {
  padding: 3px 7px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-family: var(--code-font);
  font-size: 0.785714rem;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 15px;
}

.panel-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 8px 13px;
  border-radius: 8px;
  font-size: 0.892857rem;
  font-weight: 590;
  cursor: pointer;
}

.secondary-button {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.primary-button {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
}

.panel-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }

  .stage-nav {
    position: static;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .stage-nav-item {
    min-height: 58px;
  }
}
</style>
