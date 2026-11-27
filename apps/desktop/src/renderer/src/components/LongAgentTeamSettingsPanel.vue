<script setup lang="ts">
import { removeDraftSubagent, useAgentTeamDraft } from "./useAgentTeamDraft";
import { createScopedTranslator } from "../i18n";
import {
  LONG_AGENT_IDS,
  LongAgentTeamSettingsInputSchema,
  getDefaultLongAgentProfile,
  LONG_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  type LongAgentId,
  type LongAgentTeamSettings,
  type LongAgentTeamSettingsInput,
  type ModelConfig,
  type ShortAgentSubagentDefinition,
  type SkillLibrary,
  type SubagentAuthoringDraft,
  type SubagentAuthoringRuntimeContext
} from "@deepwrite/contracts/renderer";
import { computed, ref } from "vue";
import { uiMessage } from "../ui-feedback";
import AgentTeamParallelSwitch from "./AgentTeamParallelSwitch.vue";
import AgentTeamSaveBar from "./AgentTeamSaveBar.vue";
import AgentTeamSubagentCard from "./AgentTeamSubagentCard.vue";
import AgentTeamSubagentEditor from "./AgentTeamSubagentEditor.vue";
import AgentTeamSubagentSection from "./AgentTeamSubagentSection.vue";
import LoadSubagentFromSkillDialog from "./LoadSubagentFromSkillDialog.vue";
import {
  createCopiedSubagent,
  savedWebSearchField,
  validateAgentTeamDraft
} from "./agentTeamSettingsEditorHelpers";
import { savedDrawField } from "./agentTeamDrawDraft";
import { useSubagentModelConfig } from "./useSubagentModelConfig";

const t = createScopedTranslator("components.longAgentTeamSettingsPanel");

const props = defineProps<{
  settings: LongAgentTeamSettings | null;
  readOnly?: boolean;
  models: readonly ModelConfig[];
  skills: readonly SkillLibrary[];
  preferredModelId: string | null;
  loading: boolean;
  saving: boolean;
  loadError?: string | null;
  runtimeAvailable: boolean;
  authoringGenerating: boolean;
  authoringDraft: SubagentAuthoringDraft | null;
  authoringStatusText: string | null;
  authoringError: string | null;
}>();

const emit = defineEmits<{
  retry: [];
  save: [settings: LongAgentTeamSettingsInput];
  dirtyChange: [dirty: boolean];
  authoringGenerate: [
    payload: {
      context: SubagentAuthoringRuntimeContext;
      modelId: string;
    }
  ];
  authoringStop: [];
  authoringReset: [];
}>();

const PARENT_AGENT_DESCRIPTION = computed(() =>
  t("configureSpecialistAssistantsForWorldbuildingCharactersPlotManuscriptAnd")
);

const parentAgentId: LongAgentId = LONG_AGENT_IDS[0];
const editingSubagentId = ref<string | null>(null);
const { draftTeams, draftParallelSubagents, dirty, discardChanges } =
  useAgentTeamDraft<LongAgentId>({
    settings: () => props.settings,
    onReseed: () => {
      editingSubagentId.value = null;
    },
    onDirtyChange: (value) => emit("dirtyChange", value)
  });
const loadFromSkillOpen = ref(false);
let generatedIdSequence = 0;

const formDisabled = computed(
  () => props.loading || props.saving || !props.runtimeAvailable
);
const parentAgentLabel = computed(
  () => getDefaultLongAgentProfile(parentAgentId).label
);
const activeTeam = computed(() =>
  draftTeams.value.find((team) => team.parentAgentId === parentAgentId)
);
const subagentModelConfig = useSubagentModelConfig({
  models: () => props.models,
  disabled: () => formDisabled.value || Boolean(props.readOnly)
});
const {
  modelOptions,
  thinkingOptionsFor,
  temperatureOptionsFor,
  setModelMode,
  setModelId,
  setThinkingLevel,
  setTemperature,
  subagentModelSummary
} = subagentModelConfig;

function nextSubagentId(): string {
  generatedIdSequence += 1;
  return `long_subagent_${Date.now().toString(36)}_${generatedIdSequence.toString(36)}`;
}

function addSubagent(
  draft?: Partial<
    Pick<ShortAgentSubagentDefinition, "name" | "description" | "systemPrompt">
  >
): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value || props.readOnly) return;
  if (team.subagents.length >= LONG_AGENT_SUBAGENT_MAX_COUNT) {
    uiMessage.warning(
      t("eachNovelPrimaryAgentSupportsUpToValueSubagents", {
        arg0: LONG_AGENT_SUBAGENT_MAX_COUNT
      })
    );
    return;
  }
  const id = nextSubagentId();
  const index = team.subagents.length + 1;
  team.subagents.push({
    id,
    name:
      draft?.name?.trim() ||
      t("newSubagentValue", {
        arg0: index
      }),
    description: draft?.description?.trim() || "",
    systemPrompt: draft?.systemPrompt?.trim() || "",
    enabled: true,
    agentMode: "standard",
    modelMode: "inherit"
  });
  editingSubagentId.value = id;
}

function duplicateSubagent(index: number): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value || props.readOnly) return;
  const source = team.subagents[index];
  if (!source) return;
  if (team.subagents.length >= LONG_AGENT_SUBAGENT_MAX_COUNT) {
    uiMessage.warning(
      t("eachNovelPrimaryAgentSupportsUpToValueSubagents", {
        arg0: LONG_AGENT_SUBAGENT_MAX_COUNT
      })
    );
    return;
  }
  const copied = createCopiedSubagent(
    source,
    team.subagents,
    nextSubagentId(),
    SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH
  );
  team.subagents.splice(index + 1, 0, copied);
  uiMessage.info(t("copiedToTheCurrentDraftSaveTheAgentTeam"));
}

function openLoadFromSkill(): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value || props.readOnly) return;
  if (team.subagents.length >= LONG_AGENT_SUBAGENT_MAX_COUNT) {
    uiMessage.warning(
      t("eachNovelPrimaryAgentSupportsUpToValueSubagents", {
        arg0: LONG_AGENT_SUBAGENT_MAX_COUNT
      })
    );
    return;
  }
  if (!props.skills.length) {
    uiMessage.warning(t("theSkillLibraryIsEmptyAddAnEntryIn"));
    return;
  }
  loadFromSkillOpen.value = true;
}

function closeLoadFromSkill(): void {
  if (props.authoringGenerating) return;
  loadFromSkillOpen.value = false;
  emit("authoringReset");
}

function confirmLoadFromSkill(draft: SubagentAuthoringDraft): void {
  addSubagent(draft);
  loadFromSkillOpen.value = false;
  emit("authoringReset");
  uiMessage.success(t("addedToThePrimaryAgentDraftSaveTheAgent"));
}

function editSubagent(id: string): void {
  editingSubagentId.value =
    props.readOnly && editingSubagentId.value === id ? null : id;
}

function finishEditing(): void {
  editingSubagentId.value = null;
}

function removeSubagent(index: number): void {
  if (
    !formDisabled.value &&
    !props.readOnly &&
    removeDraftSubagent(activeTeam.value, editingSubagentId, index)
  ) {
    uiMessage.info(t("removedFromTheCurrentDraftSaveTheAgentTeam"));
  }
}

function toggleSubagent(
  definition: ShortAgentSubagentDefinition,
  enabled: boolean
): void {
  if (formDisabled.value || props.readOnly) return;
  definition.enabled = enabled;
}

function saveSettings(): void {
  if (formDisabled.value || props.readOnly) return;
  const message = validateAgentTeamDraft(draftTeams.value, props.models);
  if (message) {
    uiMessage.warning(message);
    return;
  }
  const parsed = LongAgentTeamSettingsInputSchema.safeParse({
    workspaceType: "long",
    parallelSubagents: draftParallelSubagents.value,
    teams: LONG_AGENT_IDS.map((parentAgentId) => {
      const team = draftTeams.value.find(
        (candidate) => candidate.parentAgentId === parentAgentId
      );
      return {
        parentAgentId,
        subagents: (team?.subagents ?? []).map((definition) => ({
          id: definition.id,
          name: definition.name.trim(),
          description: definition.description.trim(),
          systemPrompt: definition.systemPrompt.trim(),
          enabled: definition.enabled,
          agentMode: definition.agentMode ?? "standard",
          ...savedWebSearchField(definition.webSearchMode),
          ...savedDrawField(definition.draw),
          modelMode: definition.modelMode ?? "inherit",
          ...(definition.modelMode === "custom" && definition.modelId
            ? {
                modelId: definition.modelId.trim(),
                ...(definition.thinkingLevel !== undefined
                  ? { thinkingLevel: definition.thinkingLevel }
                  : {}),
                ...(definition.thinkingLevel === "off" &&
                definition.temperature !== undefined
                  ? { temperature: definition.temperature }
                  : {})
              }
            : {})
        }))
      };
    })
  });
  if (!parsed.success) {
    uiMessage.warning(t("novelAgentTeamSettingsAreIncomplete"));
    return;
  }
  emit("save", parsed.data);
}
// Expose bindings used by the separate editor template.
defineExpose({
  AgentTeamParallelSwitch,
  AgentTeamSaveBar,
  AgentTeamSubagentCard,
  AgentTeamSubagentEditor,
  AgentTeamSubagentSection,
  draftParallelSubagents,
  LONG_AGENT_SUBAGENT_MAX_COUNT,
  LoadSubagentFromSkillDialog,
  PARENT_AGENT_DESCRIPTION,
  parentAgentLabel,
  dirty,
  modelOptions,
  subagentModelConfig,
  thinkingOptionsFor,
  temperatureOptionsFor,
  openLoadFromSkill,
  addSubagent,
  subagentModelSummary,
  toggleSubagent,
  editSubagent,
  duplicateSubagent,
  removeSubagent,
  setModelMode,
  setModelId,
  setThinkingLevel,
  setTemperature,
  finishEditing,
  discardChanges,
  saveSettings,
  closeLoadFromSkill,
  confirmLoadFromSkill
});
</script>

<template src="./LongAgentTeamSettingsPanel.template.html"></template>

<style scoped src="./LongAgentTeamSettingsPanel.css"></style>
