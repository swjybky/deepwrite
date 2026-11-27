<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import { agentTeamBoundBookCount } from "@deepwrite/contracts/renderer";
import {
  type AcademicAgentTeamSettings,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile,
  type AgentTeamProfileSaveInput,
  type AgentTeamWorkspaceType,
  type LongAgentTeamSettings,
  type ModelConfig,
  type MysteryAgentTeamSettings,
  type SkillLibrary,
  type SubagentAuthoringDraft,
  type SubagentAuthoringRuntimeContext,
  type WorkspaceAgentTeamSettings
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { academicAgentT } from "./academic/academicAgentLabels";
import AgentTeamCatalogDialogs, {
  type AgentTeamDialogMode
} from "./AgentTeamCatalogDialogs.vue";
import AgentTeamCatalogList from "./AgentTeamCatalogList.vue";
import AgentTeamSettingsPanel from "./AgentTeamSettingsPanel.vue";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.agentTeamCatalogFeature");

const props = defineProps<{
  catalog: AgentTeamCatalogSnapshot | null;
  navigationEpoch: number;
  models: readonly ModelConfig[];
  skills?: readonly SkillLibrary[];
  preferredModelId?: string | null;
  loading: boolean;
  saving: boolean;
  installing?: boolean;
  loadError?: string | null;
  runtimeAvailable: boolean;
  authoringGenerating?: boolean;
  authoringDraft?: SubagentAuthoringDraft | null;
  authoringStatusText?: string | null;
  authoringError?: string | null;
}>();

const emit = defineEmits<{
  retry: [];
  create: [input: { name: string; workspaceType: AgentTeamWorkspaceType }];
  rename: [input: { teamId: string; name: string }];
  delete: [input: { teamId: string }];
  duplicate: [input: { teamId: string }];
  download: [input: { teamId: string }];
  install: [];
  setEnabled: [input: { teamId: string; enabled: boolean }];
  save: [input: AgentTeamProfileSaveInput];
  authoringGenerate: [
    payload: { context: SubagentAuthoringRuntimeContext; modelId: string }
  ];
  authoringStop: [];
  authoringReset: [];
}>();

const selectedTeamId = ref<string | null>(null);
const editorDirty = ref(false);
const dialogMode = ref<AgentTeamDialogMode | null>(null);
const dialogTeam = ref<AgentTeamProfile | null>(null);
const pendingCreatedName = ref<string | null>(null);
const pendingSelectDuplicate = ref(false);
let pendingExistingTeamIds = new Set<string>();

const selectedTeam = computed(
  () =>
    props.catalog?.teams.find((team) => team.id === selectedTeamId.value) ??
    null
);
const editorSettings = computed<
  (WorkspaceAgentTeamSettings | AcademicAgentTeamSettings)[]
>(() =>
  selectedTeam.value &&
  (selectedTeam.value.workspaceType === "short" ||
    selectedTeam.value.workspaceType === "script" ||
    selectedTeam.value.workspaceType === "academic")
    ? [selectedTeam.value.settings]
    : []
);
const editorLongSettings = computed<LongAgentTeamSettings | null>(() =>
  selectedTeam.value?.workspaceType === "long"
    ? selectedTeam.value.settings
    : null
);
const editorMysterySettings = computed<MysteryAgentTeamSettings | null>(() =>
  selectedTeam.value?.workspaceType === "mystery"
    ? selectedTeam.value.settings
    : null
);
const selectedTeamEnabled = computed(() =>
  selectedTeam.value ? isEnabled(selectedTeam.value) : false
);

watch(
  () => props.catalog,
  (catalog) => {
    if (
      selectedTeamId.value &&
      !catalog?.teams.some((team) => team.id === selectedTeamId.value)
    ) {
      selectedTeamId.value = null;
    }
    if (pendingCreatedName.value || pendingSelectDuplicate.value) {
      const created = catalog?.teams.find(
        (team) =>
          !pendingExistingTeamIds.has(team.id) &&
          (!pendingCreatedName.value || team.name === pendingCreatedName.value)
      );
      if (created) {
        selectedTeamId.value = created.id;
      }
      pendingCreatedName.value = null;
      pendingSelectDuplicate.value = false;
      pendingExistingTeamIds = new Set();
    }
  }
);

watch(
  () => props.saving,
  (saving, wasSaving) => {
    if (wasSaving && !saving) {
      pendingCreatedName.value = null;
      pendingSelectDuplicate.value = false;
      pendingExistingTeamIds = new Set();
    }
  }
);

watch(selectedTeamId, () => {
  editorDirty.value = false;
});

watch(
  () => props.navigationEpoch,
  () => {
    if (selectedTeamId.value) emit("authoringReset");
    selectedTeamId.value = null;
    closeDialog(true);
  }
);

function workspaceTypeLabel(workspaceType: AgentTeamWorkspaceType): string {
  return workspaceType === "short"
    ? t("shortStory")
    : workspaceType === "script"
      ? t("screenplay")
      : workspaceType === "long"
        ? t("novel")
        : workspaceType === "academic"
          ? academicAgentT("tabLabel")
          : mysteryLabels("murderMystery");
}

function isEnabled(team: AgentTeamProfile): boolean {
  return props.catalog?.enabledTeamIds[team.workspaceType] === team.id;
}

function openDialog(mode: AgentTeamDialogMode, team?: AgentTeamProfile): void {
  dialogMode.value = mode;
  dialogTeam.value = team ?? null;
}

function closeDialog(force = false): void {
  if (props.saving && !force) return;
  dialogMode.value = null;
  dialogTeam.value = null;
}

function submitCreate(input: {
  name: string;
  workspaceType: AgentTeamWorkspaceType;
}): void {
  pendingSelectDuplicate.value = false;
  pendingCreatedName.value = input.name;
  pendingExistingTeamIds = new Set(props.catalog?.teams.map((team) => team.id));
  emit("create", input);
  closeDialog(true);
}

function duplicateSelectedTeam(): void {
  if (!selectedTeam.value) return;
  pendingCreatedName.value = null;
  pendingSelectDuplicate.value = true;
  pendingExistingTeamIds = new Set(props.catalog?.teams.map((team) => team.id));
  emit("duplicate", { teamId: selectedTeam.value.id });
}

function submitRename(name: string): void {
  if (dialogTeam.value) emit("rename", { teamId: dialogTeam.value.id, name });
  closeDialog(true);
}

function confirmDelete(): void {
  if (dialogTeam.value) emit("delete", { teamId: dialogTeam.value.id });
  closeDialog(true);
}

function leaveEditor(): void {
  if (editorDirty.value) {
    openDialog("leave", selectedTeam.value ?? undefined);
    return;
  }
  discardAndLeave();
}

function discardAndLeave(): void {
  closeDialog(true);
  emit("authoringReset");
  selectedTeamId.value = null;
}
</script>

<template>
  <div v-if="selectedTeam" class="team-page team-detail">
    <button type="button" class="back-button" @click="leaveEditor">
      <AppIcon name="arrow-left" :size="15" />
      <span>{{ t("backToTeams") }}</span>
    </button>
    <header class="detail-header">
      <div class="detail-title">
        <h2>{{ selectedTeam.name }}</h2>
        <span v-if="selectedTeam.isBuiltin" class="type-badge builtin-badge">{{
          t("builtin")
        }}</span>
        <span class="type-badge">{{
          workspaceTypeLabel(selectedTeam.workspaceType)
        }}</span>
      </div>
      <div class="detail-actions">
        <button
          v-if="selectedTeam.isBuiltin"
          type="button"
          class="secondary-button"
          :disabled="saving || !runtimeAvailable"
          @click="duplicateSelectedTeam"
        >
          <AppIcon name="copy" :size="15" />
          {{ t("duplicateToCustomize") }}
        </button>
        <label class="detail-enable" :class="{ 'is-on': selectedTeamEnabled }">
          {{ selectedTeamEnabled ? t("enabled") : t("notEnabled") }}
          <AgentTeamSwitch
            :model-value="selectedTeamEnabled"
            :disabled="saving || !runtimeAvailable"
            :label="
              t('teamToggleLabel', {
                action: selectedTeamEnabled ? t('disable') : t('enable'),
                name: selectedTeam.name
              })
            "
            @update:model-value="
              emit('setEnabled', { teamId: selectedTeam.id, enabled: $event })
            "
          />
        </label>
      </div>
    </header>
    <p v-if="selectedTeam.isBuiltin" class="builtin-note" role="status">
      {{ t("builtinTeamReadOnlyNotice") }}
    </p>
    <AgentTeamSettingsPanel
      :workspace-type="selectedTeam.workspaceType"
      :read-only="Boolean(selectedTeam.isBuiltin)"
      :settings="editorSettings"
      :long-settings="editorLongSettings"
      :mystery-settings="editorMysterySettings"
      :models="models"
      :skills="skills ?? []"
      :preferred-model-id="preferredModelId ?? null"
      :loading="loading"
      :saving="saving"
      :load-error="loadError ?? null"
      :long-loading="loading"
      :long-saving="saving"
      :long-load-error="loadError ?? null"
      :runtime-available="runtimeAvailable"
      :authoring-generating="Boolean(authoringGenerating)"
      :authoring-draft="authoringDraft ?? null"
      :authoring-status-text="authoringStatusText ?? null"
      :authoring-error="authoringError ?? null"
      @retry="emit('retry')"
      @save="emit('save', { teamId: selectedTeam.id, settings: $event })"
      @save-long="emit('save', { teamId: selectedTeam.id, settings: $event })"
      @save-mystery="
        emit('save', { teamId: selectedTeam.id, settings: $event })
      "
      @dirty-change="editorDirty = $event"
      @authoring-generate="emit('authoringGenerate', $event)"
      @authoring-stop="emit('authoringStop')"
      @authoring-reset="emit('authoringReset')"
    />
  </div>

  <div v-else class="team-page">
    <AgentTeamCatalogList
      :catalog="catalog"
      :loading="loading"
      :saving="saving"
      :installing="Boolean(installing)"
      :load-error="loadError"
      :runtime-available="runtimeAvailable"
      @retry="emit('retry')"
      @install="emit('install')"
      @new-team="openDialog('create')"
      @select="selectedTeamId = $event"
      @set-enabled="emit('setEnabled', $event)"
      @duplicate="emit('duplicate', { teamId: $event })"
      @download="emit('download', { teamId: $event })"
      @rename="openDialog('rename', $event)"
      @delete="openDialog('delete', $event)"
    />
  </div>

  <AgentTeamCatalogDialogs
    :mode="dialogMode"
    :team="dialogTeam"
    :bound-book-count="
      agentTeamBoundBookCount(catalog?.bookBindings, dialogTeam?.id ?? '')
    "
    :saving="saving"
    @close="closeDialog()"
    @create="submitCreate"
    @rename="submitRename"
    @confirm-delete="confirmDelete"
    @confirm-leave="discardAndLeave"
  />
</template>

<style scoped src="./AgentTeamCatalogFeature.css"></style>
