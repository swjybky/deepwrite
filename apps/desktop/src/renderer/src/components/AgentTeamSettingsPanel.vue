<script setup lang="ts">
import { removeDraftSubagent } from "./useAgentTeamDraft";
import { createScopedTranslator } from "../i18n";
import {
  ACADEMIC_AGENT_IDS,
  ACADEMIC_AGENT_SUBAGENT_MAX_COUNT,
  AcademicAgentTeamSettingsInputSchema,
  WorkspaceAgentTeamSettingsInputSchema,
  SHORT_AGENT_SUBAGENT_MAX_COUNT,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  SCRIPT_AGENT_SUBAGENT_MAX_COUNT,
  SCRIPT_WORKSPACE_AGENT_IDS,
  SHORT_WORKSPACE_AGENT_IDS,
  type AcademicAgentId,
  type AcademicAgentTeamSettings,
  type AcademicAgentTeamSettingsInput,
  type AgentTeamWorkspaceType,
  type WorkspaceAgentTeamSettings,
  type WorkspaceAgentTeamSettingsInput,
  type ModelConfig,
  type LongAgentTeamSettings,
  type LongAgentTeamSettingsInput,
  type MysteryAgentTeamSettings,
  type ShortAgentSubagentDefinition,
  type WorkspaceAgentId,
  type SkillLibrary,
  type SubagentAuthoringDraft,
  type SubagentAuthoringRuntimeContext
} from "@deepwrite/contracts/renderer";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import { uiMessage } from "../ui-feedback";
import { academicAgentT } from "./academic/academicAgentLabels";
import AgentTeamParallelSwitch from "./AgentTeamParallelSwitch.vue";
import AgentTeamSaveBar from "./AgentTeamSaveBar.vue";
import AgentTeamSubagentCard from "./AgentTeamSubagentCard.vue";
import AgentTeamSubagentEditor from "./AgentTeamSubagentEditor.vue";
import AgentTeamSubagentSection from "./AgentTeamSubagentSection.vue";
import LoadSubagentFromSkillDialog from "./LoadSubagentFromSkillDialog.vue";
import LongAgentTeamSettingsPanel from "./LongAgentTeamSettingsPanel.vue";

const MysteryAgentTeamSettingsPanel = defineAsyncComponent(
  () => import("../features/mystery/MysteryAgentTeamSettingsPanel.vue")
);
import {
  ACADEMIC_PARENT_AGENT,
  SCRIPT_PARENT_AGENTS,
  SHORT_PARENT_AGENT
} from "./agentTeamSettingsMeta";
import {
  agentTeamDraftSignature,
  createCopiedSubagent,
  validateAgentTeamDraft
} from "./agentTeamSettingsEditorHelpers";
import { clonedDrawField, savedDrawField } from "./agentTeamDrawDraft";
import { savedWebSearchField } from "./agentTeamSettingsEditorHelpers";
import { useSubagentModelConfig } from "./useSubagentModelConfig";

const t = createScopedTranslator("components.agentTeamSettingsPanel");

const props = defineProps<{
  workspaceType?: AgentTeamWorkspaceType;
  readOnly?: boolean;
  settings: readonly (WorkspaceAgentTeamSettings | AcademicAgentTeamSettings)[];
  longSettings: LongAgentTeamSettings | null;
  mysterySettings?: MysteryAgentTeamSettings | null | undefined;
  models: readonly ModelConfig[];
  skills?: readonly SkillLibrary[];
  preferredModelId?: string | null | undefined;
  loading: boolean;
  saving: boolean;
  loadError?: string | null;
  longLoading: boolean;
  longSaving: boolean;
  longLoadError?: string | null;
  runtimeAvailable: boolean;
  authoringGenerating?: boolean;
  authoringDraft?: SubagentAuthoringDraft | null | undefined;
  authoringStatusText?: string | null | undefined;
  authoringError?: string | null | undefined;
}>();

const emit = defineEmits<{
  retry: [];
  save: [
    settings: WorkspaceAgentTeamSettingsInput | AcademicAgentTeamSettingsInput
  ];
  saveLong: [settings: LongAgentTeamSettingsInput];
  saveMystery: [settings: MysteryAgentTeamSettings];
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

const loadFromSkillOpen = ref(false);

type ParentId = WorkspaceAgentId | AcademicAgentId;

const activeParentAgentId = ref<ParentId>(SHORT_PARENT_AGENT.id);
const activeWorkspaceType = ref<AgentTeamWorkspaceType>(
  props.workspaceType ?? "short"
);
type EditableTeam = {
  parentAgentId: ParentId;
  subagents: ShortAgentSubagentDefinition[];
};
const draftTeams = ref<EditableTeam[]>([]);
const draftParallelSubagents = ref(false);
const editingSubagentId = ref<string | null>(null);
let generatedIdSequence = 0;

const formDisabled = computed(
  () => props.loading || props.saving || !props.runtimeAvailable
);

const activeParentMeta = computed(
  () =>
    visibleParentAgents.value.find(
      (agent) => agent.id === activeParentAgentId.value
    ) ?? visibleParentAgents.value[0]!
);

const visibleParentAgents = computed(() =>
  activeWorkspaceType.value === "script"
    ? SCRIPT_PARENT_AGENTS
    : activeWorkspaceType.value === "academic"
      ? [ACADEMIC_PARENT_AGENT]
      : [SHORT_PARENT_AGENT]
);

const activeSubagentLimit = computed(() =>
  activeWorkspaceType.value === "script"
    ? SCRIPT_AGENT_SUBAGENT_MAX_COUNT
    : activeWorkspaceType.value === "academic"
      ? ACADEMIC_AGENT_SUBAGENT_MAX_COUNT
      : SHORT_AGENT_SUBAGENT_MAX_COUNT
);

const activeSettings = computed(() =>
  activeWorkspaceType.value === "long" ||
  activeWorkspaceType.value === "mystery"
    ? undefined
    : props.settings.find(
        (settings) => settings.workspaceType === activeWorkspaceType.value
      )
);

const activeSkills = computed(() => props.skills ?? []);

const activeTeam = computed(() =>
  draftTeams.value.find(
    (team) => team.parentAgentId === activeParentAgentId.value
  )
);

const subagentModelConfig = useSubagentModelConfig({
  models: () => props.models,
  disabled: () => formDisabled.value || Boolean(props.readOnly)
});
const {
  modelOptions,
  thinkingOptionsFor,
  temperatureOptionsFor,
  setModelMode: setSubagentModelMode,
  setModelId: setSubagentModelId,
  setThinkingLevel: setSubagentThinkingLevel,
  setTemperature: setSubagentTemperature,
  subagentModelSummary
} = subagentModelConfig;

watch(
  () => props.workspaceType,
  (workspaceType) => {
    if (workspaceType) {
      activeWorkspaceType.value = workspaceType;
      if (workspaceType === "short") {
        activeParentAgentId.value = SHORT_PARENT_AGENT.id;
      } else if (workspaceType === "academic") {
        activeParentAgentId.value = ACADEMIC_PARENT_AGENT.id;
      }
    }
  }
);

const baselineSignature = ref("");
let syncedWorkspaceType: string | null = null;
const dirty = computed(
  () =>
    agentTeamDraftSignature(draftParallelSubagents.value, draftTeams.value) !==
    baselineSignature.value
);

function cloneTeams(
  settings: WorkspaceAgentTeamSettings | AcademicAgentTeamSettings
): EditableTeam[] {
  return settings.teams.map((team) => ({
    parentAgentId: team.parentAgentId,
    subagents: team.subagents.map((subagent) => ({
      ...subagent,
      ...clonedDrawField(subagent.draw),
      agentMode: subagent.agentMode ?? "standard",
      modelMode: subagent.modelMode ?? "inherit",
      ...(subagent.modelId ? { modelId: subagent.modelId } : {}),
      ...(subagent.thinkingLevel !== undefined
        ? { thinkingLevel: subagent.thinkingLevel }
        : {}),
      ...(subagent.temperature !== undefined
        ? { temperature: subagent.temperature }
        : {})
    }))
  }));
}

// Re-seed the draft only when the saved settings really differ from what the
// draft was last seeded with, so unrelated catalog refreshes keep unsaved edits.
function syncDraft(force = false): void {
  const settings = activeSettings.value;
  const parallel = settings?.parallelSubagents ?? false;
  const teams = settings ? cloneTeams(settings) : [];
  const signature = agentTeamDraftSignature(parallel, teams);
  if (
    !force &&
    syncedWorkspaceType === activeWorkspaceType.value &&
    signature === baselineSignature.value
  ) {
    return;
  }
  // A change from outside must not wipe unsaved edits; discarding picks it up.
  if (
    !force &&
    syncedWorkspaceType === activeWorkspaceType.value &&
    dirty.value &&
    signature !==
      agentTeamDraftSignature(draftParallelSubagents.value, draftTeams.value)
  ) {
    return;
  }
  syncedWorkspaceType = activeWorkspaceType.value;
  draftParallelSubagents.value = parallel;
  draftTeams.value = teams;
  baselineSignature.value = signature;
  if (
    settings &&
    !settings.teams.some(
      (team) => team.parentAgentId === activeParentAgentId.value
    )
  ) {
    activeParentAgentId.value = visibleParentAgents.value[0]!.id;
  }
  editingSubagentId.value = null;
}

watch(
  () => [props.settings, activeWorkspaceType.value] as const,
  () => syncDraft(),
  { immediate: true, deep: true }
);

watch(
  () => [dirty.value, activeWorkspaceType.value] as const,
  ([value, workspaceType]) => {
    if (workspaceType !== "long" && workspaceType !== "mystery") {
      emit("dirtyChange", value);
    }
  },
  { immediate: true }
);

function discardChanges(): void {
  syncDraft(true);
}

function selectParentAgent(parentAgentId: ParentId): void {
  activeParentAgentId.value = parentAgentId;
  editingSubagentId.value = null;
}

function nextSubagentId(): string {
  generatedIdSequence += 1;
  return `subagent_${Date.now().toString(36)}_${generatedIdSequence.toString(36)}`;
}

function addSubagent(
  draft?: Partial<
    Pick<ShortAgentSubagentDefinition, "name" | "description" | "systemPrompt">
  >
): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value || props.readOnly) return;
  if (team.subagents.length >= activeSubagentLimit.value) {
    uiMessage.warning(
      t("thisTeamSupportsUpToValueSubagents", {
        arg0: activeSubagentLimit.value
      })
    );
    return;
  }
  const id = nextSubagentId();
  const index = team.subagents.length + 1;
  team.subagents.push({
    id,
    name: draft?.name?.trim() || t("newSubagentValue", { arg0: index }),
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
  if (team.subagents.length >= activeSubagentLimit.value) {
    uiMessage.warning(
      t("thisTeamSupportsUpToValueSubagents", {
        arg0: activeSubagentLimit.value
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
  if (formDisabled.value || props.readOnly) return;
  if (!activeTeam.value) return;
  if (activeTeam.value.subagents.length >= activeSubagentLimit.value) {
    uiMessage.warning(
      t("thisTeamSupportsUpToValueSubagents", {
        arg0: activeSubagentLimit.value
      })
    );
    return;
  }
  if (!activeSkills.value.length) {
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
  subagent: ShortAgentSubagentDefinition,
  enabled: boolean
): void {
  if (formDisabled.value || props.readOnly) return;
  subagent.enabled = enabled;
}

function saveSettings(): void {
  if (
    formDisabled.value ||
    props.readOnly ||
    activeWorkspaceType.value === "long" ||
    activeWorkspaceType.value === "mystery"
  ) {
    return;
  }
  const workspaceType = activeWorkspaceType.value;
  const parentAgentIds =
    workspaceType === "script"
      ? SCRIPT_WORKSPACE_AGENT_IDS
      : workspaceType === "academic"
        ? ACADEMIC_AGENT_IDS
        : SHORT_WORKSPACE_AGENT_IDS;
  const teams = parentAgentIds.map((parentAgentId) => {
    const team = draftTeams.value.find(
      (candidate) => candidate.parentAgentId === parentAgentId
    );
    return {
      parentAgentId,
      subagents: (team?.subagents ?? []).map((subagent) => ({
        id: subagent.id,
        name: subagent.name.trim(),
        description: subagent.description.trim(),
        systemPrompt: subagent.systemPrompt.trim(),
        enabled: subagent.enabled,
        agentMode: subagent.agentMode ?? "standard",
        ...savedWebSearchField(subagent.webSearchMode),
        ...savedDrawField(subagent.draw),
        modelMode: subagent.modelMode ?? "inherit",
        ...(subagent.modelMode === "custom" && subagent.modelId
          ? {
              modelId: subagent.modelId.trim(),
              ...(subagent.thinkingLevel !== undefined
                ? { thinkingLevel: subagent.thinkingLevel }
                : {}),
              ...(subagent.thinkingLevel === "off" &&
              subagent.temperature !== undefined
                ? { temperature: subagent.temperature }
                : {})
            }
          : {})
      }))
    };
  });
  const message = validateAgentTeamDraft(teams, props.models);
  if (message) {
    uiMessage.warning(message);
    return;
  }
  if (workspaceType === "academic") {
    const parsed = AcademicAgentTeamSettingsInputSchema.safeParse({
      workspaceType: "academic",
      parallelSubagents: draftParallelSubagents.value,
      teams
    });
    if (!parsed.success) {
      uiMessage.warning(t("agentTeamConfigurationIsIncomplete"));
      return;
    }
    emit("save", parsed.data);
    return;
  }
  const parsed = WorkspaceAgentTeamSettingsInputSchema.safeParse({
    workspaceType,
    parallelSubagents: draftParallelSubagents.value,
    teams
  });
  if (!parsed.success) {
    uiMessage.warning(t("agentTeamConfigurationIsIncomplete"));
    return;
  }
  emit("save", parsed.data);
}

defineExpose({
  academicAgentT,
  AgentTeamParallelSwitch,
  AgentTeamSaveBar,
  AgentTeamSubagentCard,
  AgentTeamSubagentEditor,
  AgentTeamSubagentSection,
  draftParallelSubagents,
  LoadSubagentFromSkillDialog,
  LongAgentTeamSettingsPanel,
  MysteryAgentTeamSettingsPanel,
  mysteryLabels,
  activeParentMeta,
  activeSubagentLimit,
  visibleParentAgents,
  dirty,
  modelOptions,
  subagentModelConfig,
  thinkingOptionsFor,
  temperatureOptionsFor,
  selectParentAgent,
  openLoadFromSkill,
  closeLoadFromSkill,
  confirmLoadFromSkill,
  addSubagent,
  setSubagentModelMode,
  setSubagentModelId,
  setSubagentThinkingLevel,
  setSubagentTemperature,
  subagentModelSummary,
  editSubagent,
  finishEditing,
  duplicateSubagent,
  removeSubagent,
  toggleSubagent,
  discardChanges,
  saveSettings
});
</script>

<template src="./AgentTeamSettingsPanel.template.html"></template>

<style scoped src="./AgentTeamSettingsPanel.css"></style>
