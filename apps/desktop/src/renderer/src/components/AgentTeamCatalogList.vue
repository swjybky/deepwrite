<script setup lang="ts">
import type {
  AgentTeamCatalogSnapshot,
  AgentTeamProfile,
  AgentTeamWorkspaceType
} from "@deepwrite/contracts/renderer";
import { agentTeamBoundBookCount } from "@deepwrite/contracts/renderer";
import { computed, ref } from "vue";
import { createScopedTranslator } from "../i18n";
import AgentTeamBindingGuide from "./AgentTeamBindingGuide.vue";
import AgentTeamSwitch from "./AgentTeamSwitch.vue";
import AppIcon from "./AppIcon.vue";
import BuiltinSubagentSettings from "./BuiltinSubagentSettings.vue";

const t = createScopedTranslator("components.agentTeamCatalogList");

const props = defineProps<{
  catalog: AgentTeamCatalogSnapshot | null;
  loading: boolean;
  saving: boolean;
  installing?: boolean;
  loadError?: string | null | undefined;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  retry: [];
  install: [];
  newTeam: [];
  select: [teamId: string];
  setEnabled: [input: { teamId: string; enabled: boolean }];
  download: [teamId: string];
  rename: [team: AgentTeamProfile];
  delete: [team: AgentTeamProfile];
}>();

const WORKSPACE_TYPES = ["short", "script", "long"] as const;
type TypeFilter = AgentTeamWorkspaceType | "all";

const typeFilter = ref<TypeFilter>("all");
const busy = computed(() => props.saving || !props.runtimeAvailable);
const teams = computed(() => props.catalog?.teams ?? []);
const visibleTeams = computed(() =>
  typeFilter.value === "all"
    ? teams.value
    : teams.value.filter((team) => team.workspaceType === typeFilter.value)
);
const filters = computed<{ value: TypeFilter; label: string }[]>(() => [
  { value: "all", label: t("all") },
  ...WORKSPACE_TYPES.map((value) => ({
    value,
    label: workspaceTypeLabel(value)
  }))
]);
const activeSlots = computed(() =>
  WORKSPACE_TYPES.map((type) => ({
    type,
    team: teams.value.find(
      (team) => isEnabled(team) && team.workspaceType === type
    )
  }))
);

function workspaceTypeLabel(type: AgentTeamWorkspaceType): string {
  return type === "short"
    ? t("shortStory")
    : type === "script"
      ? t("screenplay")
      : t("novel");
}

function isEnabled(team: AgentTeamProfile): boolean {
  return props.catalog?.enabledTeamIds[team.workspaceType] === team.id;
}

function boundBookCount(team: AgentTeamProfile): number {
  return agentTeamBoundBookCount(props.catalog?.bookBindings, team.id);
}

function subagentCount(team: AgentTeamProfile): number {
  return team.settings.teams.reduce(
    (total, item) => total + item.subagents.length,
    0
  );
}
</script>

<template>
  <section class="team-catalog" aria-labelledby="team-catalog-title">
    <header class="catalog-header">
      <div>
        <h2 id="team-catalog-title">{{ t("agentTeams") }}</h2>
      </div>
      <div class="catalog-header-actions">
        <button
          type="button"
          class="secondary-button"
          :disabled="busy || installing"
          :title="t('importFileTypes')"
          @click="emit('install')"
        >
          <AppIcon name="archive" :size="16" />
          {{ t("installTeam") }}
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="busy"
          @click="emit('newTeam')"
        >
          <AppIcon name="plus" :size="16" />
          {{ t("newTeam") }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="catalog-state" aria-live="polite">
      {{ t("loadingAgentTeams") }}
    </div>
    <div v-else-if="loadError && !catalog" class="catalog-state" role="alert">
      <strong>{{ t("agentTeamsHaveNotLoaded") }}</strong>
      <p>{{ loadError }}</p>
      <button type="button" class="secondary-button" @click="emit('retry')">
        {{ t("reload") }}
      </button>
    </div>

    <template v-else>
      <section class="active-strip" :aria-label="t('currentlyActive')">
        <h3>{{ t("currentlyActive") }}</h3>
        <div class="active-slots">
          <template v-for="slot in activeSlots" :key="slot.type">
            <button
              v-if="slot.team"
              type="button"
              class="active-slot"
              @click="emit('select', slot.team.id)"
            >
              <span class="type-badge">{{
                workspaceTypeLabel(slot.type)
              }}</span>
              <strong>{{ slot.team.name }}</strong>
            </button>
            <div v-else class="active-slot is-empty">
              <span class="type-badge">{{
                workspaceTypeLabel(slot.type)
              }}</span>
              <strong>{{ t("notEnabled") }}</strong>
            </div>
          </template>
        </div>
      </section>

      <AgentTeamBindingGuide />

      <section class="team-section" aria-labelledby="creative-teams-title">
        <header class="section-header">
          <h3 id="creative-teams-title">
            {{ t("writingTeams") }}
            <span class="section-count">{{ visibleTeams.length }}</span>
          </h3>
          <div class="type-filter" role="group" :aria-label="t('writingType')">
            <button
              v-for="filter in filters"
              :key="filter.value"
              type="button"
              :class="{ 'is-selected': typeFilter === filter.value }"
              :aria-pressed="typeFilter === filter.value"
              @click="typeFilter = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>
        </header>

        <div v-if="!visibleTeams.length" class="catalog-state">
          <strong>{{ t("noTeamsYet") }}</strong>
          <p>{{ t("createATeamOrInstallADownloadedOne") }}</p>
        </div>
        <div v-else class="team-grid">
          <article
            v-for="team in visibleTeams"
            :key="team.id"
            class="team-card"
            :class="{ 'is-active': isEnabled(team) }"
          >
            <button
              type="button"
              class="team-card-main"
              @click="emit('select', team.id)"
            >
              <span class="team-title-row">
                <strong>{{ team.name }}</strong>
                <span class="type-badge">{{
                  workspaceTypeLabel(team.workspaceType)
                }}</span>
              </span>
              <span class="team-meta">
                <span>{{
                  t("subagentsMessage", { arg0: subagentCount(team) })
                }}</span>
                <span>{{
                  team.settings.parallelSubagents
                    ? t("parallelOn")
                    : t("parallelOff")
                }}</span>
                <span v-if="boundBookCount(team)">{{
                  t("boundToBooks", { arg0: boundBookCount(team) })
                }}</span>
              </span>
            </button>
            <footer class="team-card-footer">
              <label class="enable-row" :class="{ 'is-on': isEnabled(team) }">
                <AgentTeamSwitch
                  :model-value="isEnabled(team)"
                  :disabled="busy"
                  :label="
                    t('teamToggleLabel', {
                      action: isEnabled(team) ? t('disable') : t('enable'),
                      name: team.name
                    })
                  "
                  :title="
                    isEnabled(team)
                      ? t('disableTeam')
                      : t('enableThisValueTeam', {
                          arg0: workspaceTypeLabel(team.workspaceType)
                        })
                  "
                  @update:model-value="
                    emit('setEnabled', { teamId: team.id, enabled: $event })
                  "
                />
                {{ isEnabled(team) ? t("enabled") : t("notEnabled") }}
              </label>
              <div class="team-actions">
                <button
                  type="button"
                  :disabled="busy"
                  :aria-label="t('download')"
                  :title="t('download')"
                  @click="emit('download', team.id)"
                >
                  <AppIcon name="download" :size="15" />
                </button>
                <button
                  type="button"
                  :disabled="busy"
                  :aria-label="t('rename')"
                  :title="t('rename')"
                  @click="emit('rename', team)"
                >
                  <AppIcon name="edit" :size="15" />
                </button>
                <button
                  type="button"
                  class="is-danger"
                  :disabled="busy || isEnabled(team)"
                  :aria-label="t('deleteTeam')"
                  :title="
                    isEnabled(team)
                      ? t('disableThisTeamFirst')
                      : t('deleteTeam')
                  "
                  @click="emit('delete', team)"
                >
                  <AppIcon name="trash" :size="15" />
                </button>
              </div>
            </footer>
          </article>
        </div>
      </section>

      <BuiltinSubagentSettings
        v-if="catalog"
        :settings="catalog.builtinSubagents"
        :disabled="loading || saving || !runtimeAvailable"
      />
    </template>
  </section>
</template>

<style scoped src="./AgentTeamCatalogList.css"></style>
