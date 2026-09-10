<script setup lang="ts">
import BuiltinSubagentSettings from "./BuiltinSubagentSettings.vue";
import {
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  type AgentTeamCatalogSnapshot,
  type AgentTeamProfile,
  type AgentTeamProfileSaveInput,
  type AgentTeamWorkspaceType,
  type LongAgentTeamSettings,
  type ModelConfig,
  type SkillLibrary,
  type SubagentAuthoringDraft,
  type SubagentAuthoringRuntimeContext,
  type WorkspaceAgentTeamSettings
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";
import { uiMessage } from "../ui-feedback";
import AgentTeamSettingsPanel from "./AgentTeamSettingsPanel.vue";
import AppIcon from "./AppIcon.vue";
import PopupSelect, { type PopupSelectOption } from "./PopupSelect.vue";

const props = defineProps<{
  catalog: AgentTeamCatalogSnapshot | null;
  navigationEpoch: number;
  models: readonly ModelConfig[];
  skills?: readonly SkillLibrary[];
  preferredModelId?: string | null;
  loading: boolean;
  saving: boolean;
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
const dialogMode = ref<"create" | "rename" | "delete" | null>(null);
const dialogTeam = ref<AgentTeamProfile | null>(null);
const nameDraft = ref("");
const createWorkspaceType = ref<AgentTeamWorkspaceType>("short");
const pendingCreatedName = ref<string | null>(null);
let pendingExistingTeamIds = new Set<string>();

const selectedTeam = computed(
  () =>
    props.catalog?.teams.find((team) => team.id === selectedTeamId.value) ??
    null
);
const editorSettings = computed<WorkspaceAgentTeamSettings[]>(() =>
  selectedTeam.value && selectedTeam.value.workspaceType !== "long"
    ? [selectedTeam.value.settings]
    : []
);
const editorLongSettings = computed<LongAgentTeamSettings | null>(() =>
  selectedTeam.value?.workspaceType === "long"
    ? selectedTeam.value.settings
    : null
);
const workspaceTypeOptions: PopupSelectOption[] = [
  { value: "short", label: "短篇" },
  { value: "script", label: "剧本" },
  { value: "long", label: "长篇" }
];
const catalogTeams = computed(() => props.catalog?.teams ?? []);

watch(
  () => props.catalog,
  (catalog) => {
    if (
      selectedTeamId.value &&
      !catalog?.teams.some((team) => team.id === selectedTeamId.value)
    ) {
      selectedTeamId.value = null;
    }
    if (pendingCreatedName.value) {
      const created = catalog?.teams.find(
        (team) =>
          team.name === pendingCreatedName.value &&
          !pendingExistingTeamIds.has(team.id)
      );
      if (created) {
        selectedTeamId.value = created.id;
      }
      pendingCreatedName.value = null;
      pendingExistingTeamIds = new Set();
    }
  }
);

watch(
  () => props.navigationEpoch,
  () => {
    if (selectedTeamId.value) emit("authoringReset");
    selectedTeamId.value = null;
    closeDialog();
  }
);

function subagentCount(team: AgentTeamProfile): number {
  return team.settings.teams.reduce(
    (total, item) => total + item.subagents.length,
    0
  );
}

function workspaceTypeLabel(workspaceType: AgentTeamWorkspaceType): string {
  return workspaceType === "short"
    ? "短篇"
    : workspaceType === "script"
      ? "剧本"
      : "长篇";
}

function isEnabled(team: AgentTeamProfile): boolean {
  return props.catalog?.enabledTeamIds[team.workspaceType] === team.id;
}

function openCreate(): void {
  dialogMode.value = "create";
  dialogTeam.value = null;
  nameDraft.value = "";
  createWorkspaceType.value = "short";
}

function openRename(team: AgentTeamProfile): void {
  dialogMode.value = "rename";
  dialogTeam.value = team;
  nameDraft.value = team.name;
}

function openDelete(team: AgentTeamProfile): void {
  dialogMode.value = "delete";
  dialogTeam.value = team;
}

function closeDialog(): void {
  if (props.saving) return;
  dialogMode.value = null;
  dialogTeam.value = null;
  nameDraft.value = "";
}

function submitName(): void {
  const name = nameDraft.value.trim();
  if (!name) {
    uiMessage.warning("请输入团队名称。");
    return;
  }
  if (dialogMode.value === "create") {
    pendingCreatedName.value = name;
    pendingExistingTeamIds = new Set(
      props.catalog?.teams.map((team) => team.id)
    );
    emit("create", { name, workspaceType: createWorkspaceType.value });
  } else if (dialogMode.value === "rename" && dialogTeam.value) {
    emit("rename", { teamId: dialogTeam.value.id, name });
  }
  dialogMode.value = null;
}

function confirmDelete(): void {
  if (!dialogTeam.value) return;
  emit("delete", { teamId: dialogTeam.value.id });
  dialogMode.value = null;
}

function leaveEditor(): void {
  emit("authoringReset");
  selectedTeamId.value = null;
}
</script>

<template>
  <div v-if="selectedTeam" class="team-detail">
    <header class="detail-navigation">
      <button type="button" class="back-button" @click="leaveEditor">
        <AppIcon name="chevron" :size="14" />
        <span>返回团队列表</span>
      </button>
      <strong>{{ selectedTeam.name }}</strong>
      <span class="type-badge">{{
        workspaceTypeLabel(selectedTeam.workspaceType)
      }}</span>
      <span v-if="isEnabled(selectedTeam)" class="active-badge">已启用</span>
    </header>
    <AgentTeamSettingsPanel
      :workspace-type="selectedTeam.workspaceType"
      :settings="editorSettings"
      :long-settings="editorLongSettings"
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
      @authoring-generate="emit('authoringGenerate', $event)"
      @authoring-stop="emit('authoringStop')"
      @authoring-reset="emit('authoringReset')"
    />
  </div>

  <section v-else class="team-catalog" aria-labelledby="team-catalog-title">
    <header class="catalog-header">
      <div>
        <span>学习仿写 · 智能体团队</span>
        <h2 id="team-catalog-title">智能体团队</h2>
        <p>
          每个团队只服务一种创作类型；每种类型最多启用一个，也可以全部关闭。
        </p>
      </div>
      <div class="catalog-header-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="saving || !runtimeAvailable"
          @click="emit('install')"
        >
          <AppIcon name="archive" :size="16" />
          安装团队
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="saving || !runtimeAvailable"
          @click="openCreate"
        >
          <AppIcon name="plus" :size="16" />
          新建团队
        </button>
      </div>
    </header>

    <BuiltinSubagentSettings
      v-if="catalog"
      :settings="catalog.builtinSubagents"
      :disabled="loading || saving || !runtimeAvailable"
    />
    <h2 id="creative-teams-title" class="team-section-title">创作团队</h2>
    <div v-if="loading" class="catalog-state">正在加载智能体团队…</div>
    <div v-else-if="loadError && !catalog" class="catalog-state" role="alert">
      <strong>智能体团队未加载</strong>
      <p>{{ loadError }}</p>
      <button type="button" class="secondary-button" @click="emit('retry')">
        重新加载
      </button>
    </div>
    <div v-else class="team-grid">
      <article
        v-for="team in catalogTeams"
        :key="team.id"
        class="team-card"
        :class="{ 'is-active': isEnabled(team) }"
        @click="selectedTeamId = team.id"
      >
        <div class="team-card-top">
          <button
            type="button"
            class="enable-selector"
            :class="{ 'is-selected': isEnabled(team) }"
            :disabled="saving || !runtimeAvailable"
            :aria-label="`${isEnabled(team) ? '关闭' : '启用'}${team.name}`"
            :aria-pressed="isEnabled(team)"
            :title="
              isEnabled(team)
                ? '关闭团队'
                : `启用该${workspaceTypeLabel(team.workspaceType)}团队`
            "
            @click.stop="
              emit('setEnabled', { teamId: team.id, enabled: !isEnabled(team) })
            "
          >
            <AppIcon v-if="isEnabled(team)" name="check" :size="14" />
          </button>
          <button
            type="button"
            class="team-card-main"
            @click.stop="selectedTeamId = team.id"
          >
            <span class="team-title-row">
              <strong>{{ team.name }}</strong>
              <span class="type-badge">{{
                workspaceTypeLabel(team.workspaceType)
              }}</span>
            </span>
            <span class="team-counts"
              >{{ subagentCount(team) }} 个子智能体</span
            >
          </button>
        </div>
        <div class="team-actions">
          <button
            type="button"
            :disabled="saving || !runtimeAvailable"
            @click.stop="emit('download', { teamId: team.id })"
          >
            <AppIcon name="download" :size="13" />
            下载
          </button>
          <button
            type="button"
            :disabled="saving || !runtimeAvailable"
            @click.stop="openRename(team)"
          >
            重命名
          </button>
          <button
            type="button"
            class="delete-button"
            :disabled="saving || !runtimeAvailable || isEnabled(team)"
            :title="isEnabled(team) ? '请先关闭该团队' : '删除团队'"
            @click.stop="openDelete(team)"
          >
            删除
          </button>
        </div>
      </article>
    </div>
  </section>

  <Teleport to="body">
    <div v-if="dialogMode" class="dialog-backdrop" @click.self="closeDialog">
      <section class="team-dialog" role="dialog" aria-modal="true">
        <template v-if="dialogMode === 'delete'">
          <h3>确认删除“{{ dialogTeam?.name }}”？</h3>
          <p>
            该{{
              workspaceTypeLabel(dialogTeam?.workspaceType ?? "short")
            }}团队中的子智能体配置会被删除，此操作不可恢复。
          </p>
          <div class="dialog-actions">
            <button type="button" @click="closeDialog">取消</button>
            <button
              type="button"
              class="danger-button"
              :disabled="saving"
              @click="confirmDelete"
            >
              确认删除
            </button>
          </div>
        </template>
        <template v-else>
          <h3>
            {{
              dialogMode === "create" ? "新建智能体团队" : "重命名智能体团队"
            }}
          </h3>
          <label>
            团队名称
            <input
              v-model="nameDraft"
              :maxlength="AGENT_TEAM_PROFILE_NAME_MAX_LENGTH"
              autofocus
              @keyup.enter="submitName"
            />
          </label>
          <label v-if="dialogMode === 'create'">
            创作类型
            <PopupSelect
              v-model="createWorkspaceType"
              :options="workspaceTypeOptions"
              accessible-label="团队创作类型"
              :menu-z-index="2200"
            />
          </label>
          <div class="dialog-actions">
            <button type="button" @click="closeDialog">取消</button>
            <button
              type="button"
              class="primary-button"
              :disabled="saving"
              @click="submitName"
            >
              确认
            </button>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./AgentTeamCatalogFeature.css"></style>
