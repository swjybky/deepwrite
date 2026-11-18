<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type {
  CreativePlotStage,
  LongAgentSettings,
  LongAgentSettingsInput,
  ScriptWorkspaceAgentSettings,
  ShortWorkspaceAgentSettings,
  WorkspaceAgentSettings,
  WorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { computed, defineAsyncComponent, ref } from "vue";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import BookTemplateSettings from "./BookTemplateSettings.vue";
import LongAgentSettingsPanel from "./LongAgentSettingsPanel.vue";
import ScriptAgentSettingsPanel from "./ScriptAgentSettingsPanel.vue";
import UnifiedShortAgentSettingsPanel from "./UnifiedShortAgentSettingsPanel.vue";
import { academicAgentT } from "./academic/academicAgentLabels";

const AcademicAgentSettingsPanel = defineAsyncComponent(
  () => import("./academic/AcademicAgentSettingsPanel.vue")
);

const MysteryAgentSettingsPanel = defineAsyncComponent(
  () => import("../features/mystery/MysteryAgentSettingsPanel.vue")
);

const t = createScopedTranslator("components.shortAgentSettingsPanel");

const props = defineProps<{
  settings: readonly WorkspaceAgentSettings[];
  creativePlotStages: readonly CreativePlotStage[];
  longSettings: LongAgentSettings | null;
  loading: boolean;
  saving: boolean;
  longLoading: boolean;
  longSaving: boolean;
  longErrorMessage: string | null;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  retryLong: [];
  save: [input: WorkspaceAgentSettingsInput];
  saveLong: [input: LongAgentSettingsInput];
}>();

const activeType = ref<"short" | "script" | "long" | "academic" | "mystery">(
  "short"
);
const shortSettings = computed(
  () =>
    (props.settings.find(({ workspaceType }) => workspaceType === "short") as
      ShortWorkspaceAgentSettings | undefined) ?? null
);
const scriptSettings = computed(
  () =>
    (props.settings.find(({ workspaceType }) => workspaceType === "script") as
      ScriptWorkspaceAgentSettings | undefined) ?? null
);
</script>

<template>
  <section
    class="workspace-agent-settings"
    aria-labelledby="agent-settings-title"
  >
    <header>
      <span>{{ t("workspace") }}</span>
      <h2 id="agent-settings-title">
        {{ t("agentSettings") }}
      </h2>
      <p>
        {{ t("configureThePrimaryAgentSPromptWelcomeShortcutsAnd") }}
      </p>
      <p v-if="!runtimeAvailable" class="runtime-note">
        {{ t("thisEnvironmentSupportsViewingOnlyUseTheDeepWriteDesktop") }}
      </p>
    </header>

    <div class="workspace-tabs" role="tablist" :aria-label="t('writingType')">
      <button
        v-for="type in [
          'short',
          'script',
          'long',
          'academic',
          'mystery'
        ] as const"
        :key="type"
        type="button"
        role="tab"
        :class="{ 'is-active': activeType === type }"
        :aria-selected="activeType === type"
        @click="activeType = type"
      >
        {{
          type === "short"
            ? t("shortStory")
            : type === "script"
              ? t("screenplay")
              : type === "long"
                ? t("novel")
                : type === "academic"
                  ? academicAgentT("tabLabel")
                  : mysteryLabels("murderMystery")
        }}
      </button>
    </div>

    <UnifiedShortAgentSettingsPanel
      v-if="activeType === 'short'"
      :settings="shortSettings"
      :plot-stages="creativePlotStages"
      :loading="loading"
      :saving="saving"
      :runtime-available="runtimeAvailable"
      @save="emit('save', $event)"
    />
    <ScriptAgentSettingsPanel
      v-else-if="activeType === 'script'"
      :settings="scriptSettings"
      :loading="loading"
      :saving="saving"
      :runtime-available="runtimeAvailable"
      @save="emit('save', $event)"
    />
    <AcademicAgentSettingsPanel
      v-else-if="activeType === 'academic'"
      :runtime-available="runtimeAvailable"
    />
    <MysteryAgentSettingsPanel
      v-else-if="activeType === 'mystery'"
      :runtime-available="runtimeAvailable"
    />
    <LongAgentSettingsPanel
      v-else
      :settings="longSettings"
      :loading="longLoading"
      :saving="longSaving"
      :load-error="longErrorMessage"
      :runtime-available="runtimeAvailable"
      @retry="emit('retryLong')"
      @save="emit('saveLong', $event)"
    />
    <BookTemplateSettings
      v-if="activeType === 'short' || activeType === 'script'"
      :key="activeType"
      :workspace-type="activeType"
      :default-stage-ids="shortSettings?.defaultPlotStageIds ?? []"
      :disabled="
        !runtimeAvailable ||
        loading ||
        (activeType === 'short' && !shortSettings)
      "
    />
  </section>
</template>

<style scoped>
.workspace-agent-settings {
  width: min(100%, 980px);
  color: var(--text-primary);
}
header {
  margin-bottom: 20px;
}
header > span {
  color: var(--text-tertiary);
  font-size: 0.785714rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
header h2 {
  margin: 4px 0 5px;
  font-size: 1.57143rem;
}
header p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}
.runtime-note {
  margin-top: 5px;
  color: var(--warning);
}
.workspace-tabs {
  display: flex;
  gap: 6px;
  margin: -6px 0 18px;
  padding: 5px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 11px;
  background: var(--surface-muted);
}
.workspace-tabs button {
  min-width: 104px;
  min-height: 36px;
  padding: 7px 13px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.workspace-tabs button.is-active {
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow: 0 1px 3px
    color-mix(in srgb, var(--theme-foreground) 9%, transparent);
}
</style>
