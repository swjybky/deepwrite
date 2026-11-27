<script setup lang="ts">
import {
  builtinAgentLabel,
  builtinAgentDescription
} from "../i18n/builtinLabels";
import { createScopedTranslator } from "../i18n";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_DEFAULT_PLOT_STAGE_IDS,
  ShortWorkspaceAgentSettingsInputSchema,
  type CreativePlotStage,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import WorkspaceAgentProfileForm from "./WorkspaceAgentProfileForm.vue";
import { patchWorkspaceAgentReadAccess } from "./workspaceAgentProfileDraft";

const t = createScopedTranslator("components.unifiedShortAgentSettingsPanel");

type EditableAgent = ShortWorkspaceAgentSettingsInput["agents"][number];

const props = defineProps<{
  settings: ShortWorkspaceAgentSettings | null;
  plotStages: readonly CreativePlotStage[];
  loading: boolean;
  saving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  save: [input: ShortWorkspaceAgentSettingsInput];
}>();

const draft = ref<EditableAgent | null>(null);
const defaultPlotStageIds = ref<string[]>([]);
const selectedDefaultPlotStageIds = computed(() => {
  const availableIds = new Set(props.plotStages.map(({ id }) => id));
  return defaultPlotStageIds.value.filter((id) => availableIds.has(id));
});

const defaultPlotStages = computed(() =>
  props.plotStages.map((stage) => ({
    ...stage,
    enabled: selectedDefaultPlotStageIds.value.includes(stage.id),
    locked:
      selectedDefaultPlotStageIds.value.length === 1 &&
      selectedDefaultPlotStageIds.value.includes(stage.id)
  }))
);

function cloneAgent(
  agent: ShortWorkspaceAgentSettings["agents"][number]
): EditableAgent {
  return {
    id: agent.id,
    systemPrompt: agent.systemPrompt,
    welcomeShortcuts: [...agent.welcomeShortcuts],
    readAccess: {
      material: [...agent.readAccess.material],
      skill: [...agent.readAccess.skill]
    }
  };
}

watch(
  () => props.settings,
  (settings) => {
    draft.value = settings?.agents[0] ? cloneAgent(settings.agents[0]) : null;
    defaultPlotStageIds.value = settings
      ? [...settings.defaultPlotStageIds]
      : [...SHORT_DEFAULT_PLOT_STAGE_IDS];
  },
  { immediate: true, deep: true }
);

function patchAccess(
  scope: "material" | "skill",
  id: string,
  checked: boolean
): void {
  patchWorkspaceAgentReadAccess(draft.value, scope, id, checked);
}

function patchDefaultPlotStage(id: string, enabled: boolean): void {
  const next = new Set(selectedDefaultPlotStageIds.value);
  if (enabled) next.add(id);
  else next.delete(id);
  if (next.size === 0) {
    uiMessage.warning(t("keepAtLeastOneDefaultPlotStage"));
    return;
  }
  defaultPlotStageIds.value = props.plotStages
    .filter((stage) => next.has(stage.id))
    .map((stage) => stage.id);
}

function reset(): void {
  const builtin = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES[0];
  if (!builtin) return;
  draft.value = cloneAgent(builtin);
  defaultPlotStageIds.value = [...SHORT_DEFAULT_PLOT_STAGE_IDS];
  uiMessage.info(t("shortStoryAgentResetToBuiltInDefaultsSave"));
}

function save(): void {
  if (!draft.value) return;
  const shortcuts = draft.value.welcomeShortcuts.map((value) => value.trim());
  const parsed = ShortWorkspaceAgentSettingsInputSchema.safeParse({
    workspaceType: "short",
    defaultPlotStageIds: selectedDefaultPlotStageIds.value,
    agents: [
      {
        ...draft.value,
        welcomeShortcuts: shortcuts
      }
    ]
  });
  if (!parsed.success) {
    uiMessage.warning(t("shortStoryAgentSettingsAreIncomplete"));
    return;
  }
  emit("save", parsed.data);
}
</script>

<template>
  <div v-if="loading" class="panel-state">
    {{ t("loadingShortStoryAgentSettings") }}
  </div>
  <div v-else-if="!settings || !draft" class="panel-state">
    {{ t("noShortStoryAgentSettingsAvailable") }}
  </div>
  <WorkspaceAgentProfileForm
    v-else
    :agent="draft"
    :label="builtinAgentLabel('short', settings.agents[0]?.label)"
    :description="
      builtinAgentDescription('short', settings.agents[0]?.description)
    "
    :eyebrow="t('unifiedAgent')"
    :disabled="saving || !runtimeAvailable"
    :saving="saving"
    :save-label="t('saveShortStoryAgentSettings')"
    :show-welcome-shortcuts="false"
    :default-plot-stages="defaultPlotStages"
    @prompt="draft.systemPrompt = $event"
    @access="patchAccess"
    @default-plot-stage="patchDefaultPlotStage"
    @reset="reset"
    @save="save"
  />
</template>

<style scoped>
.panel-state {
  padding: 48px 20px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  text-align: center;
}
</style>
