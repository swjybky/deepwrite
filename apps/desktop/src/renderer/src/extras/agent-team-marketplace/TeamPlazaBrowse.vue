<script setup lang="ts">
import { computed } from "vue";
import type {
  AgentTeamMarketplaceSort,
  AgentTeamWorkspaceType
} from "@deepwrite/contracts";
import AppIcon from "../../components/AppIcon.vue";
import PopupSelect from "../../components/PopupSelect.vue";
import { createScopedTranslator } from "../../i18n";
import type {
  PopupSelectOption,
  PopupSelectValue
} from "../../types/popupSelect";
import TeamPlazaPagination from "./TeamPlazaPagination.vue";
import { workspaceTypeLabel } from "./teamPlazaLabels";
import { TEAM_PLAZA_PAGE_SIZE, type TeamPlazaController } from "./useTeamPlaza";

const t = createScopedTranslator("extras.agentTeamMarketplace");

const props = defineProps<{ plaza: TeamPlazaController }>();

const workspaceTypeOptions = computed<PopupSelectOption[]>(() => [
  { value: "", label: t("allWorkspaceTypes") },
  ...(["short", "script", "long", "academic"] as const).map((value) => ({
    value,
    label: workspaceTypeLabel(value)
  }))
]);
const sortOptions = computed<PopupSelectOption[]>(() => [
  { value: "latest", label: t("newest") },
  { value: "popular", label: t("popular") },
  { value: "downloads", label: t("mostDownloaded") },
  { value: "likes", label: t("mostLiked") }
]);

function setWorkspaceType(value: PopupSelectValue): void {
  props.plaza.setFilter("workspaceType", value as AgentTeamWorkspaceType | "");
  void props.plaza.loadBrowse(1);
}

function setSort(value: PopupSelectValue): void {
  props.plaza.setFilter("sort", value as AgentTeamMarketplaceSort);
  void props.plaza.loadBrowse(1);
}

function setQuery(event: Event): void {
  props.plaza.setFilter("query", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <section class="plaza-browse">
    <form class="plaza-filters" @submit.prevent="plaza.loadBrowse(1)">
      <label class="search-field">
        <AppIcon name="search" :size="16" />
        <input
          :value="plaza.filters.query"
          :placeholder="t('searchPlaceholder')"
          maxlength="256"
          @input="setQuery"
        />
      </label>
      <PopupSelect
        :model-value="plaza.filters.workspaceType"
        :options="workspaceTypeOptions"
        :accessible-label="t('workspaceTypeFilter')"
        variant="compact"
        @update:model-value="setWorkspaceType"
      />
      <PopupSelect
        :model-value="plaza.filters.sort"
        :options="sortOptions"
        :accessible-label="t('sortFilter')"
        variant="compact"
        @update:model-value="setSort"
      />
      <button
        class="secondary-button compact"
        type="button"
        :disabled="plaza.browse.loading"
        @click="plaza.loadBrowse()"
      >
        {{ plaza.browse.loading ? t("refreshing") : t("refresh") }}
      </button>
      <button class="primary-button compact" type="submit">
        {{ t("search") }}
      </button>
    </form>

    <div
      v-if="plaza.browse.loading && plaza.browse.items.length === 0"
      class="plaza-empty"
    >
      <span>{{ t("loadingTeams") }}</span>
    </div>
    <div v-else-if="plaza.browse.items.length === 0" class="plaza-empty">
      <strong>{{ t("noMatchingTeams") }}</strong>
      <span>{{ t("tryDifferentFilters") }}</span>
    </div>
    <div v-else class="team-grid">
      <article
        v-for="item in plaza.browse.items"
        :key="item.id"
        class="team-card"
      >
        <div class="plaza-row card-tags">
          <span class="badge accent">{{
            workspaceTypeLabel(item.workspaceType)
          }}</span>
          <span class="badge">{{
            t("memberCount", { count: item.memberCount })
          }}</span>
        </div>
        <button
          class="card-title"
          type="button"
          @click="plaza.openDetail(item)"
        >
          {{ item.title }}
        </button>
        <p>{{ item.overview || t("noOverview") }}</p>
        <div class="plaza-row card-meta">
          <span>{{ item.ownerName || item.ownerUsername }}</span>
          <span>v{{ item.version }}</span>
        </div>
        <div class="plaza-row card-actions">
          <button
            type="button"
            class="text-button"
            :aria-pressed="item.likedByMe"
            :aria-label="t('like')"
            @click="plaza.toggleLike(item)"
          >
            <span :class="{ liked: item.likedByMe }">♥</span>
            {{ item.likeCount }}
          </button>
          <span>{{ t("downloads", { count: item.downloadCount }) }}</span>
          <button
            type="button"
            class="secondary-button compact details-button"
            :disabled="plaza.detailLoadingId.value === item.id"
            @click="plaza.openDetail(item)"
          >
            {{ t("details") }}
          </button>
          <button
            type="button"
            class="primary-button compact"
            :disabled="plaza.installAction(item).disabled"
            @click="plaza.install(item)"
          >
            {{ plaza.installAction(item).label }}
          </button>
        </div>
      </article>
    </div>
    <TeamPlazaPagination
      :page="plaza.browse.page"
      :total-pages="plaza.browse.totalPages"
      :total="plaza.browse.total"
      :page-size="TEAM_PLAZA_PAGE_SIZE"
      :loading="plaza.browse.loading"
      @change="plaza.loadBrowse"
    />
  </section>
</template>

<style scoped src="./team-plaza.css"></style>
<style scoped>
.plaza-filters {
  display: grid;
  grid-template-columns:
    minmax(210px, 1fr) repeat(2, minmax(130px, auto))
    auto auto;
  gap: 9px;
  margin-bottom: 18px;
}
.search-field {
  position: relative;
  display: flex;
  align-items: center;
}
.search-field svg {
  position: absolute;
  left: 11px;
  color: var(--text-tertiary);
}
.search-field input {
  padding-left: 34px;
}
.team-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 13px;
}
.team-card {
  display: grid;
  gap: 11px;
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-main);
}
.team-card:hover {
  border-color: var(--theme-line);
  background: var(--surface-hover);
}
.card-tags {
  justify-content: flex-start;
}
.card-title {
  border: 0;
  padding: 0;
  overflow: hidden;
  color: var(--text-primary);
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.team-card p {
  display: -webkit-box;
  min-height: 3em;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.card-meta,
.card-actions {
  color: var(--text-tertiary);
  font-size: 12px;
}
.card-actions {
  justify-content: flex-start;
}
.details-button {
  margin-left: auto;
}
@media (max-width: 1180px) {
  .plaza-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr)) auto auto;
  }
  .search-field {
    grid-column: 1 / -1;
  }
}
@media (max-width: 560px) {
  .plaza-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
