<script setup lang="ts">
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
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import AgentTeamParallelSwitch from "./AgentTeamParallelSwitch.vue";
import AgentTeamSaveBar from "./AgentTeamSaveBar.vue";
import AgentTeamSubagentCard from "./AgentTeamSubagentCard.vue";
import AgentTeamSubagentEditor from "./AgentTeamSubagentEditor.vue";
import AgentTeamSubagentSection from "./AgentTeamSubagentSection.vue";
import LoadSubagentFromSkillDialog from "./LoadSubagentFromSkillDialog.vue";
import {
  agentTeamDraftSignature,
  createCopiedSubagent,
  savedWebSearchField,
  validateAgentTeamDraft
} from "./agentTeamSettingsEditorHelpers";
import { clonedDrawField, savedDrawField } from "./agentTeamDrawDraft";
import { useSubagentModelConfig } from "./useSubagentModelConfig";

const t = createScopedTranslator("components.longAgentTeamSettingsPanel");

const props = defineProps<{
  settings: LongAgentTeamSettings | null;
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
const draftTeams = ref<LongAgentTeamSettingsInput["teams"]>([]);
const draftParallelSubagents = ref(false);
const editingSubagentId = ref<string | null>(null);
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
  disabled: () => formDisabled.value
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

const baselineSignature = ref("");
let seeded = false;
const dirty = computed(
  () =>
    agentTeamDraftSignature(draftParallelSubagents.value, draftTeams.value) !==
    baselineSignature.value
);

function cloneTeams(
  settings: LongAgentTeamSettings
): LongAgentTeamSettingsInput["teams"] {
  return settings.teams.map((team) => ({
    parentAgentId: team.parentAgentId,
    subagents: team.subagents.map((definition) => ({
      ...definition,
      ...clonedDrawField(definition.draw),
      agentMode: definition.agentMode ?? "standard",
      modelMode: definition.modelMode ?? "inherit",
      ...(definition.modelId ? { modelId: definition.modelId } : {}),
      ...(definition.thinkingLevel !== undefined
        ? { thinkingLevel: definition.thinkingLevel }
        : {}),
      ...(definition.temperature !== undefined
        ? { temperature: definition.temperature }
        : {})
    }))
  }));
}

// Re-seed the draft only when the saved settings really differ from what the
// draft was last seeded with, so unrelated catalog refreshes keep unsaved edits.
function syncDraft(force = false): void {
  const settings = props.settings;
  const parallel = settings?.parallelSubagents ?? false;
  const teams = settings ? cloneTeams(settings) : [];
  const signature = agentTeamDraftSignature(parallel, teams);
  if (!force && seeded && signature === baselineSignature.value) return;
  // A change from outside must not wipe unsaved edits; discarding picks it up.
  if (
    !force &&
    seeded &&
    dirty.value &&
    signature !==
      agentTeamDraftSignature(draftParallelSubagents.value, draftTeams.value)
  ) {
    return;
  }
  seeded = true;
  draftParallelSubagents.value = parallel;
  draftTeams.value = teams;
  baselineSignature.value = signature;
  editingSubagentId.value = null;
}

watch(
  () => props.settings,
  () => syncDraft(),
  {
    immediate: true,
    deep: true
  }
);

watch(dirty, (value) => emit("dirtyChange", value), { immediate: true });

function discardChanges(): void {
  syncDraft(true);
}

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
  if (!team || formDisabled.value) return;
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
  if (!team || formDisabled.value) return;
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
  if (!team || formDisabled.value) return;
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
  editingSubagentId.value = id;
}

function finishEditing(): void {
  editingSubagentId.value = null;
}

function removeSubagent(index: number): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value) return;
  const [removed] = team.subagents.splice(index, 1);
  if (removed && editingSubagentId.value === removed.id) {
    editingSubagentId.value = null;
  }
  if (removed) {
    uiMessage.info(t("removedFromTheCurrentDraftSaveTheAgentTeam"));
  }
}

function toggleSubagent(
  definition: ShortAgentSubagentDefinition,
  enabled: boolean
): void {
  if (formDisabled.value) return;
  definition.enabled = enabled;
}

function saveSettings(): void {
  if (formDisabled.value) return;
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
