<script setup lang="ts">
import {
  AcademicAgentSettingsInputSchema,
  ACADEMIC_AGENT_IDS,
  type AcademicAgentSettingsInputAgent,
  type ShortAgentSubagentModelMode
} from "@deepwrite/contracts/renderer";
import { computed, onMounted, ref, watch } from "vue";
import { formatError } from "../../i18n/errors";
import {
  builtinAgentDescription,
  builtinAgentLabel
} from "../../i18n/builtinLabels";
import { useSettingsStore } from "../../stores/settingsStore";
import { uiMessage } from "../../ui-feedback";
import { withAcademicAgentBaseline } from "../../utils/agentSettingsBaseline";
import PopupSelect from "../PopupSelect.vue";
import { useSubagentModelConfig } from "../useSubagentModelConfig";
import { academicAgentT } from "./academicAgentLabels";

const props = defineProps<{
  runtimeAvailable: boolean;
}>();

const settingsStore = useSettingsStore();
const agentId = ACADEMIC_AGENT_IDS[0];
const draftAgent = ref<AcademicAgentSettingsInputAgent | null>(null);

const models = computed(() => settingsStore.modelSettings?.models ?? []);
const loading = computed(() => settingsStore.academicAgentLoading);
const saving = computed(() => settingsStore.academicAgentSaving);
const loadError = computed(() => settingsStore.academicAgentLoadError);
const activeProfile = computed(() =>
  settingsStore.academicAgentSettings.agents.find((item) => item.id === agentId)
);
const formDisabled = computed(
  () =>
    loading.value ||
    saving.value ||
    Boolean(loadError.value) ||
    !props.runtimeAvailable
);

const modelConfig = useSubagentModelConfig({
  models: () => models.value,
  disabled: () => formDisabled.value
});

const modelModeOptions = computed(() => [
  { value: "inherit", label: academicAgentT("modelInherit") },
  { value: "custom", label: academicAgentT("modelCustom") }
]);

async function ensureLoaded(): Promise<void> {
  const api = window.deepwrite;
  if (!api) return;
  try {
    await Promise.all([
      settingsStore.ensureAcademicAgentsLoaded(() => api.academicAgents.list()),
      settingsStore.modelsLoaded
        ? Promise.resolve()
        : settingsStore.ensureModelsLoaded(() => api.models.list())
    ]);
  } catch (error: unknown) {
    uiMessage.error(formatError(error, academicAgentT("loadFailedTitle")));
  }
}

onMounted(() => {
  void ensureLoaded();
});

watch(
  () => settingsStore.academicAgentSettings,
  (settings) => {
    const source = settings.agents.find((item) => item.id === agentId);
    if (!source) return;
    draftAgent.value = {
      id: source.id,
      systemPrompt: source.systemPrompt,
      welcomeShortcuts: [
        source.welcomeShortcuts[0],
        source.welcomeShortcuts[1],
        source.welcomeShortcuts[2]
      ],
      modelMode: source.modelMode ?? "inherit",
      ...(source.modelId ? { modelId: source.modelId } : {}),
      ...(source.thinkingLevel !== undefined
        ? { thinkingLevel: source.thinkingLevel }
        : {}),
      ...(source.temperature !== undefined
        ? { temperature: source.temperature }
        : {})
    };
  },
  { immediate: true, deep: true }
);

function handleModelModeChange(value: string | number): void {
  if (!draftAgent.value) return;
  modelConfig.setModelMode(
    draftAgent.value,
    value as ShortAgentSubagentModelMode
  );
}

function handleModelIdChange(value: string | number): void {
  if (!draftAgent.value) return;
  modelConfig.setModelId(draftAgent.value, String(value));
}

function handleThinkingChange(value: string | number): void {
  if (!draftAgent.value) return;
  modelConfig.setThinkingLevel(draftAgent.value, String(value));
}

function handleTemperatureChange(value: string | number): void {
  if (!draftAgent.value) return;
  modelConfig.setTemperature(draftAgent.value, Number(value));
}

async function resetDefaults(): Promise<void> {
  const api = window.deepwrite;
  if (!api || formDisabled.value) return;
  settingsStore.academicAgentSaving = true;
  try {
    const saved = await api.academicAgents.reset(agentId);
    settingsStore.markLoaded("academicAgents", saved);
    uiMessage.success(academicAgentT("restoredSuccess"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, academicAgentT("restoreFailed")));
  } finally {
    settingsStore.academicAgentSaving = false;
  }
}

async function saveSettings(): Promise<void> {
  const api = window.deepwrite;
  const current = draftAgent.value;
  if (!api || !current || formDisabled.value) return;

  const candidate = {
    workspaceType: "academic" as const,
    agents: [
      {
        id: current.id,
        systemPrompt: current.systemPrompt.trim(),
        welcomeShortcuts: [
          current.welcomeShortcuts[0].trim(),
          current.welcomeShortcuts[1].trim(),
          current.welcomeShortcuts[2].trim()
        ] as [string, string, string],
        modelMode: current.modelMode ?? "inherit",
        ...(current.modelMode === "custom" && current.modelId
          ? {
              modelId: current.modelId.trim(),
              ...(current.thinkingLevel !== undefined
                ? { thinkingLevel: current.thinkingLevel }
                : {}),
              ...(current.thinkingLevel === "off" &&
              current.temperature !== undefined
                ? { temperature: current.temperature }
                : {})
            }
          : {})
      }
    ]
  };

  const parsed = AcademicAgentSettingsInputSchema.safeParse(candidate);
  if (!parsed.success) {
    uiMessage.warning(academicAgentT("incompleteWarning"));
    return;
  }

  settingsStore.academicAgentSaving = true;
  try {
    const saved = await api.academicAgents.save(
      withAcademicAgentBaseline(
        parsed.data,
        settingsStore.academicAgentSettings
      )
    );
    settingsStore.markLoaded("academicAgents", saved);
    uiMessage.success(academicAgentT("savedSuccess"));
  } catch (error: unknown) {
    uiMessage.error(formatError(error, academicAgentT("saveFailed")));
  } finally {
    settingsStore.academicAgentSaving = false;
  }
}
</script>

<template>
  <div v-if="loading" class="panel-state" aria-live="polite">
    {{ academicAgentT("loadingSettings") }}
  </div>
  <div v-else-if="loadError" class="panel-state" role="alert">
    <strong>{{ academicAgentT("loadFailedTitle") }}</strong>
    <p>{{ loadError }}</p>
    <button
      type="button"
      class="secondary-button"
      :disabled="loading"
      @click="ensureLoaded"
    >
      {{ academicAgentT("reload") }}
    </button>
  </div>
  <div v-else-if="!draftAgent" class="panel-state">
    {{ academicAgentT("unavailable") }}
  </div>
  <div v-else class="academic-agent-settings-layout">
    <div class="agent-editor">
      <header class="agent-header">
        <span>{{ academicAgentT("eyebrow") }}</span>
        <h3>{{ builtinAgentLabel("academic", activeProfile?.label) }}</h3>
        <p>
          {{ builtinAgentDescription("academic", activeProfile?.description) }}
        </p>
      </header>

      <section class="settings-card">
        <div class="section-heading">
          <div>
            <h4>{{ academicAgentT("modelTitle") }}</h4>
            <p>{{ academicAgentT("modelDesc") }}</p>
          </div>
        </div>
        <div class="model-grid">
          <label class="field-item">
            <span>{{ academicAgentT("modelTitle") }}</span>
            <PopupSelect
              :model-value="draftAgent.modelMode ?? 'inherit'"
              :options="modelModeOptions"
              :accessible-label="academicAgentT('modelTitle')"
              :disabled="formDisabled"
              @update:model-value="handleModelModeChange"
            />
          </label>
          <template v-if="draftAgent.modelMode === 'custom'">
            <label class="field-item">
              <span>{{ academicAgentT("modelSelectLabel") }}</span>
              <PopupSelect
                :model-value="draftAgent.modelId ?? ''"
                :options="modelConfig.modelOptions.value"
                :accessible-label="academicAgentT('modelSelectLabel')"
                :disabled="formDisabled"
                @update:model-value="handleModelIdChange"
              />
            </label>
            <label class="field-item">
              <span>{{ academicAgentT("thinkingSelectLabel") }}</span>
              <PopupSelect
                :model-value="draftAgent.thinkingLevel ?? 'medium'"
                :options="modelConfig.thinkingOptionsFor(draftAgent)"
                :accessible-label="academicAgentT('thinkingSelectLabel')"
                :disabled="formDisabled"
                @update:model-value="handleThinkingChange"
              />
            </label>
            <label v-if="draftAgent.thinkingLevel === 'off'" class="field-item">
              <span>{{ academicAgentT("temperatureSelectLabel") }}</span>
              <PopupSelect
                :model-value="draftAgent.temperature ?? 0.7"
                :options="modelConfig.temperatureOptionsFor(draftAgent)"
                :accessible-label="academicAgentT('temperatureSelectLabel')"
                :disabled="formDisabled"
                @update:model-value="handleTemperatureChange"
              />
            </label>
          </template>
        </div>
      </section>

      <section class="settings-card">
        <div class="section-heading">
          <div>
            <h4>{{ academicAgentT("shortcutsTitle") }}</h4>
            <p>{{ academicAgentT("shortcutsDesc") }}</p>
          </div>
        </div>
        <div class="shortcuts-list">
          <label
            v-for="(_, index) in draftAgent.welcomeShortcuts"
            :key="index"
            class="field-item"
          >
            <span>{{
              academicAgentT("shortcutLabel", { index: index + 1 })
            }}</span>
            <input
              v-model="draftAgent.welcomeShortcuts[index]"
              type="text"
              maxlength="120"
              :disabled="formDisabled"
            />
          </label>
        </div>
      </section>

      <section class="settings-card prompt-card">
        <div class="section-heading">
          <div>
            <h4>{{ academicAgentT("systemPromptTitle") }}</h4>
            <p>{{ academicAgentT("systemPromptDesc") }}</p>
          </div>
          <span>{{
            academicAgentT("charCount", {
              count: draftAgent.systemPrompt.length
            })
          }}</span>
        </div>
        <textarea
          v-model="draftAgent.systemPrompt"
          :disabled="formDisabled"
          spellcheck="false"
          :aria-label="academicAgentT('systemPromptAria')"
          :placeholder="academicAgentT('systemPromptPlaceholder')"
        />
      </section>

      <section class="settings-card">
        <div class="section-heading">
          <div>
            <h4>{{ academicAgentT("boundaryTitle") }}</h4>
          </div>
        </div>
        <p class="boundary-line">{{ academicAgentT("boundaryZones") }}</p>
        <p class="boundary-line">{{ academicAgentT("boundaryHardLines") }}</p>
      </section>

      <footer class="panel-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="formDisabled"
          @click="resetDefaults"
        >
          {{ academicAgentT("restoreDefaults") }}
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="formDisabled"
          @click="saveSettings"
        >
          {{
            saving ? academicAgentT("saving") : academicAgentT("saveSettings")
          }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.panel-state {
  padding: 28px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
}

.academic-agent-settings-layout {
  display: grid;
  gap: 18px;
  align-items: start;
}

.agent-editor {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.agent-header span,
.section-heading span {
  color: var(--text-tertiary);
  font-size: 12px;
}

.agent-header h3 {
  margin: 4px 0;
  color: var(--text-primary);
  font-size: 20px;
}

.agent-header p,
.section-heading p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}

.settings-card {
  padding: 16px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-heading h4 {
  margin: 0 0 4px;
  color: var(--text-primary);
  font-size: 15px;
}

.model-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.shortcuts-list {
  display: grid;
  gap: 10px;
}

.field-item {
  display: grid;
  gap: 6px;
}

.field-item > span {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

input,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: none;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
}

input {
  min-height: 36px;
  padding: 7px 11px;
}

textarea {
  min-height: 240px;
  padding: 12px;
  resize: vertical;
  line-height: 1.55;
}

input:focus,
textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.boundary-line {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

.boundary-line:last-child {
  margin-bottom: 0;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.secondary-button,
.primary-button {
  min-height: 38px;
  padding: 8px 14px;
  border-radius: 9px;
  font: inherit;
  cursor: pointer;
}

.secondary-button {
  border: 1px solid var(--theme-line);
  background: var(--surface-raised);
  color: var(--text-primary);
}

.primary-button {
  border: 1px solid var(--text-primary);
  background: var(--text-primary);
  color: var(--surface-main);
}

button:disabled,
textarea:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

@media (max-width: 760px) {
  .model-grid {
    grid-template-columns: 1fr;
  }
}
</style>
