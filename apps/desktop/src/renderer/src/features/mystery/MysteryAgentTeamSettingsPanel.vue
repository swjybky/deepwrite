<script setup lang="ts">
import {
  LONG_AGENT_SUBAGENT_MAX_COUNT,
  MYSTERY_AGENT_IDS,
  MysteryAgentTeamSettingsSchema,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  type ModelConfig,
  type MysteryAgentId,
  type MysteryAgentTeamSettings,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts/renderer";
import { computed, ref, watch } from "vue";
import AgentTeamParallelSwitch from "../../components/AgentTeamParallelSwitch.vue";
import AgentTeamSaveBar from "../../components/AgentTeamSaveBar.vue";
import AgentTeamSubagentCard from "../../components/AgentTeamSubagentCard.vue";
import AgentTeamSubagentEditor from "../../components/AgentTeamSubagentEditor.vue";
import AgentTeamSubagentSection from "../../components/AgentTeamSubagentSection.vue";
import {
  clonedDrawField,
  savedDrawField
} from "../../components/agentTeamDrawDraft";
import {
  agentTeamDraftSignature,
  createCopiedSubagent,
  savedWebSearchField,
  validateAgentTeamDraft
} from "../../components/agentTeamSettingsEditorHelpers";
import { useSubagentModelConfig } from "../../components/useSubagentModelConfig";
import { uiMessage } from "../../ui-feedback";
import { mysteryT } from "./messages";
import { mysteryLabels } from "./mysterySharedLabels";

const props = defineProps<{
  settings: MysteryAgentTeamSettings | null;
  models: readonly ModelConfig[];
  loading: boolean;
  saving: boolean;
  loadError?: string | null;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  save: [settings: MysteryAgentTeamSettings];
  dirtyChange: [dirty: boolean];
}>();

const parentAgentId: MysteryAgentId = MYSTERY_AGENT_IDS[0];
const draftTeams = ref<MysteryAgentTeamSettings["teams"]>([]);
const draftParallelSubagents = ref(false);
const editingSubagentId = ref<string | null>(null);
let generatedIdSequence = 0;

const formDisabled = computed(
  () => props.loading || props.saving || !props.runtimeAvailable
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
  settings: MysteryAgentTeamSettings
): MysteryAgentTeamSettings["teams"] {
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

function syncDraft(force = false): void {
  const settings = props.settings;
  const parallel = settings?.parallelSubagents ?? false;
  const teams = settings ? cloneTeams(settings) : [];
  const signature = agentTeamDraftSignature(parallel, teams);
  if (!force && seeded && signature === baselineSignature.value) return;
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
  { immediate: true, deep: true }
);

watch(dirty, (value) => emit("dirtyChange", value), { immediate: true });

function discardChanges(): void {
  syncDraft(true);
}

function nextSubagentId(): string {
  generatedIdSequence += 1;
  return `mystery_subagent_${Date.now().toString(36)}_${generatedIdSequence.toString(36)}`;
}

function addSubagent(): void {
  const team = activeTeam.value;
  if (!team || formDisabled.value) return;
  if (team.subagents.length >= LONG_AGENT_SUBAGENT_MAX_COUNT) return;
  const id = nextSubagentId();
  team.subagents.push({
    id,
    name: `${mysteryLabels("murderMystery")} #${team.subagents.length + 1}`,
    description: "",
    systemPrompt: "",
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
  if (!source || team.subagents.length >= LONG_AGENT_SUBAGENT_MAX_COUNT) return;
  const copied = createCopiedSubagent(
    source,
    team.subagents,
    nextSubagentId(),
    SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH
  );
  team.subagents.splice(index + 1, 0, copied);
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
  const parsed = MysteryAgentTeamSettingsSchema.safeParse({
    workspaceType: "mystery",
    parallelSubagents: draftParallelSubagents.value,
    teams: MYSTERY_AGENT_IDS.map((pid) => {
      const team = draftTeams.value.find(
        (candidate) => candidate.parentAgentId === pid
      );
      return {
        parentAgentId: pid,
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
    uiMessage.warning(
      parsed.error.issues[0]?.message ?? mysteryT("saveFailed")
    );
    return;
  }
  emit("save", parsed.data);
}
</script>

<template>
  <div v-if="loading" class="panel-state" aria-live="polite">
    {{ mysteryT("loadingTitle") }}
  </div>
  <div v-else-if="loadError && !settings" class="panel-state" role="alert">
    <p>{{ loadError }}</p>
    <button type="button" class="secondary-button" @click="emit('retry')">
      {{ mysteryT("backToList") }}
    </button>
  </div>
  <div v-else-if="!settings || !activeTeam" class="panel-state">
    {{ mysteryT("emptyTitle") }}
  </div>
  <div v-else class="team-editor">
    <AgentTeamParallelSwitch
      v-model="draftParallelSubagents"
      :disabled="formDisabled"
    />
    <AgentTeamSubagentSection
      :count="activeTeam.subagents.length"
      :limit="LONG_AGENT_SUBAGENT_MAX_COUNT"
      :description="mysteryT('teamPanelSubtitle')"
      :note="mysteryT('subagentModePureBare')"
      :disabled="formDisabled"
      :limit-reached="
        activeTeam.subagents.length >= LONG_AGENT_SUBAGENT_MAX_COUNT
      "
      hide-load-from-skill
      @add="addSubagent()"
    >
      <AgentTeamSubagentCard
        v-for="(definition, index) in activeTeam.subagents"
        :key="definition.id"
        :subagent="definition"
        :editing="editingSubagentId === definition.id"
        :disabled="formDisabled"
        :duplicate-disabled="
          activeTeam.subagents.length >= LONG_AGENT_SUBAGENT_MAX_COUNT
        "
        :model-summary="subagentModelSummary(definition)"
        @toggle="toggleSubagent(definition, $event)"
        @edit="editSubagent(definition.id)"
        @duplicate="duplicateSubagent(index)"
        @remove="removeSubagent(index)"
      >
        <AgentTeamSubagentEditor
          v-model:name="definition.name"
          v-model:description="definition.description"
          v-model:system-prompt="definition.systemPrompt"
          v-model:agent-mode="definition.agentMode"
          v-model:web-search-mode="definition.webSearchMode"
          v-model:draw="definition.draw"
          :model-config="subagentModelConfig"
          :subagent="definition"
          :disabled="formDisabled"
          :model-options="modelOptions"
          :thinking-options="thinkingOptionsFor(definition)"
          :temperature-options="temperatureOptionsFor(definition)"
          @set-model-mode="setModelMode(definition, $event)"
          @set-model-id="setModelId(definition, $event)"
          @set-thinking-level="setThinkingLevel(definition, $event)"
          @set-temperature="setTemperature(definition, $event)"
          @done="finishEditing"
        />
      </AgentTeamSubagentCard>
    </AgentTeamSubagentSection>

    <AgentTeamSaveBar
      :dirty="dirty"
      :saving="saving"
      :disabled="formDisabled"
      @save="saveSettings"
      @discard="discardChanges"
    />
  </div>
</template>

<style scoped src="../../components/LongAgentTeamSettingsPanel.css"></style>
