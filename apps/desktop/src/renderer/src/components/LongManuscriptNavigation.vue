<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { LongChapterCardId } from "@deepwrite/contracts";
import { handleHorizontalOverflowWheel } from "../utils/horizontalOverflow";
import {
  longChapterNavigationMove,
  orderLongChapterNavigationItems
} from "../utils/orderLongChapterNavigationItems";
import {
  LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE,
  longManuscriptNavigationPageCount,
  longManuscriptNavigationPageForIndex,
  longManuscriptNavigationPageSlice
} from "./longManuscriptNavigationPagination";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.longManuscriptNavigation");

export interface LongManuscriptNavigationItem {
  id: LongChapterCardId;
  label: string;
  narrativeOrder?: number;
  recorded?: boolean;
}

const props = defineProps<{
  mode: "top-tabs" | "right-list";
  label: string;
  items: LongManuscriptNavigationItem[];
  activeChapterId: LongChapterCardId | null;
  locked?: boolean;
  committed?: boolean;
}>();

const emit = defineEmits<{
  selectChapter: [chapterCardId: LongChapterCardId];
  createChapter: [];
  editChapter: [chapterCardId: LongChapterCardId];
  deleteChapter: [chapterCardId: LongChapterCardId];
  reorderChapter: [chapterCardId: LongChapterCardId, direction: "up" | "down"];
}>();

const actionMenuId = ref<LongChapterCardId | null>(null);
const actionMenuTrigger = ref<HTMLButtonElement | null>(null);
const orderedItems = computed(() =>
  orderLongChapterNavigationItems(props.items)
);
const page = ref(1);
const pageCount = computed(() =>
  longManuscriptNavigationPageCount(orderedItems.value.length)
);
const pageOffset = computed(
  () => (page.value - 1) * LONG_MANUSCRIPT_NAVIGATION_PAGE_SIZE
);
const visibleItems = computed(() =>
  longManuscriptNavigationPageSlice(orderedItems.value, page.value)
);
const activeChapter = computed(
  () =>
    orderedItems.value.find(({ id }) => id === props.activeChapterId) ?? null
);

function ensureActiveChapterVisible(): void {
  const activeIndex = orderedItems.value.findIndex(
    ({ id }) => id === props.activeChapterId
  );
  page.value = Math.min(
    pageCount.value,
    props.activeChapterId
      ? longManuscriptNavigationPageForIndex(activeIndex)
      : page.value
  );
}

function setPage(nextPage: number): void {
  page.value = Math.min(Math.max(1, nextPage), pageCount.value);
  actionMenuId.value = null;
}

watch([orderedItems, () => props.activeChapterId], ensureActiveChapterVisible, {
  immediate: true
});
watch(page, () => {
  actionMenuId.value = null;
});

function moveBlocked(index: number, direction: "up" | "down"): boolean {
  return (
    longChapterNavigationMove(
      orderedItems.value,
      pageOffset.value + index,
      direction
    ) !== "allowed"
  );
}

function moveTitle(
  index: number,
  direction: "up" | "down"
): string | undefined {
  return longChapterNavigationMove(
    orderedItems.value,
    pageOffset.value + index,
    direction
  ) === "recorded"
    ? t("recordedChapterOrderLocked")
    : undefined;
}

function toggleActionMenu(
  chapterCardId: LongChapterCardId,
  event: MouseEvent
): void {
  actionMenuTrigger.value = event.currentTarget as HTMLButtonElement;
  actionMenuId.value =
    actionMenuId.value === chapterCardId ? null : chapterCardId;
}

function runMenuAction(
  chapterCardId: LongChapterCardId,
  action: "edit" | "up" | "down" | "delete"
): void {
  if (props.locked) return;
  actionMenuId.value = null;
  if (action === "edit") {
    actionMenuTrigger.value?.focus();
    emit("editChapter", chapterCardId);
  } else if (action === "delete") {
    emit("deleteChapter", chapterCardId);
  } else {
    emit("reorderChapter", chapterCardId, action);
  }
}

function handleWindowPointerDown(event: PointerEvent): void {
  if (!actionMenuId.value) return;
  const target = event.target;
  if (
    !(target instanceof Element) ||
    !target.closest(".long-manuscript-card-actions")
  ) {
    actionMenuId.value = null;
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", handleWindowPointerDown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", handleWindowPointerDown, true);
});
</script>

<template>
  <nav
    v-if="mode === 'top-tabs'"
    class="section-tabs-bar long-worldbuilding-tabs long-chapter-card-tabs"
    :aria-label="label"
  >
    <div
      class="section-tabs-scroll"
      role="tablist"
      @wheel="handleHorizontalOverflowWheel"
    >
      <button
        v-for="chapter in visibleItems"
        :key="chapter.id"
        class="section-tab"
        :class="{ 'is-active': activeChapterId === chapter.id }"
        type="button"
        role="tab"
        :aria-selected="activeChapterId === chapter.id"
        :title="chapter.label"
        @click="emit('selectChapter', chapter.id)"
      >
        {{ chapter.label }}
      </button>
    </div>
    <div
      v-if="pageCount > 1"
      class="long-manuscript-pagination"
      :aria-label="t('chapterPagination')"
    >
      <button
        type="button"
        :aria-label="t('previousPage')"
        :title="t('previousPage')"
        :disabled="page === 1"
        @click="setPage(page - 1)"
      >
        <AppIcon name="arrow-left" :size="13" />
      </button>
      <span>{{ t("pageOf", { page, pages: pageCount }) }}</span>
      <button
        type="button"
        :aria-label="t('nextPage')"
        :title="t('nextPage')"
        :disabled="page === pageCount"
        @click="setPage(page + 1)"
      >
        <AppIcon name="arrow-right" :size="13" />
      </button>
    </div>
    <button
      class="long-worldbuilding-add"
      type="button"
      :aria-label="t('addChapterCard')"
      :title="t('addChapterCard')"
      :disabled="locked"
      @click="emit('createChapter')"
    >
      <AppIcon name="plus" :size="15" />
    </button>
    <button
      class="long-worldbuilding-remove"
      type="button"
      :aria-label="t('deleteCurrentChapterCard')"
      :title="
        committed
          ? t('deleteThisChapterCardAndItsManuscriptAndContinuity')
          : activeChapter
            ? t('deleteCurrentChapterCard')
            : t('selectAChapterCardFirst')
      "
      :disabled="locked || !activeChapter"
      @click="activeChapter && emit('deleteChapter', activeChapter.id)"
    >
      <AppIcon name="minus" :size="15" />
    </button>
  </nav>

  <aside
    v-else
    class="long-story-plot-pane long-entry-list-pane"
    :aria-label="t('chapterCards')"
  >
    <header>
      <div>
        <strong>{{ t("chapterCard") }}</strong>
        <span>{{ orderedItems.length }}</span>
      </div>
      <div class="long-entry-list-actions">
        <button
          type="button"
          :aria-label="t('addChapterCard')"
          :title="t('addChapterCard')"
          :disabled="locked"
          @click="emit('createChapter')"
        >
          <AppIcon name="plus" :size="14" />
        </button>
        <button
          type="button"
          :aria-label="t('deleteCurrentChapterCard')"
          :disabled="locked || !activeChapter"
          @click="activeChapter && emit('deleteChapter', activeChapter.id)"
        >
          <AppIcon name="minus" :size="14" />
        </button>
      </div>
    </header>
    <div class="long-story-plot-list" role="list">
      <article
        v-for="(chapter, index) in visibleItems"
        :key="chapter.id"
        class="long-story-plot-card"
        :class="{
          'is-active': activeChapterId === chapter.id,
          'is-menu-open': actionMenuId === chapter.id
        }"
        role="listitem"
      >
        <button
          class="long-story-plot-card-main"
          type="button"
          :aria-pressed="activeChapterId === chapter.id"
          :title="chapter.label"
          @click="emit('selectChapter', chapter.id)"
        >
          <span class="long-story-plot-card-order">{{ index + 1 }}</span>
          <span class="long-story-plot-card-title">{{ chapter.label }}</span>
        </button>
        <div
          class="long-story-plot-card-actions long-manuscript-card-actions"
          :class="{ 'is-menu-open': actionMenuId === chapter.id }"
        >
          <button
            class="long-story-plot-more-button"
            :class="{ 'is-active': actionMenuId === chapter.id }"
            type="button"
            :aria-label="
              t('moreActionsForValue', {
                arg0: chapter.label
              })
            "
            :aria-expanded="actionMenuId === chapter.id"
            aria-haspopup="menu"
            :disabled="locked"
            @click.stop="toggleActionMenu(chapter.id, $event)"
          >
            <AppIcon name="more" :size="16" />
          </button>
          <div
            v-if="actionMenuId === chapter.id"
            class="long-story-plot-action-menu"
            :class="{
              'opens-upward': index >= 2 && index >= visibleItems.length - 2
            }"
            role="menu"
            @keydown.esc.stop="actionMenuId = null"
          >
            <button
              class="long-story-plot-action-menu-item"
              type="button"
              role="menuitem"
              :disabled="locked"
              @click.stop="runMenuAction(chapter.id, 'edit')"
            >
              <AppIcon name="edit" :size="14" />
              <span>{{ t("change") }}</span>
            </button>
            <button
              class="long-story-plot-action-menu-item"
              type="button"
              role="menuitem"
              :disabled="locked || moveBlocked(index, 'up')"
              :title="moveTitle(index, 'up')"
              @click.stop="runMenuAction(chapter.id, 'up')"
            >
              <AppIcon name="arrow-up" :size="14" />
              <span>{{ t("moveUp") }}</span>
            </button>
            <button
              class="long-story-plot-action-menu-item"
              type="button"
              role="menuitem"
              :disabled="locked || moveBlocked(index, 'down')"
              :title="moveTitle(index, 'down')"
              @click.stop="runMenuAction(chapter.id, 'down')"
            >
              <AppIcon
                class="long-story-plot-arrow-down"
                name="arrow-up"
                :size="14"
              />
              <span>{{ t("moveDown") }}</span>
            </button>
            <button
              class="long-story-plot-action-menu-item is-danger"
              type="button"
              role="menuitem"
              :disabled="locked"
              @click.stop="runMenuAction(chapter.id, 'delete')"
            >
              <AppIcon name="trash" :size="14" />
              <span>{{ t("delete") }}</span>
            </button>
          </div>
        </div>
      </article>
    </div>
    <div
      v-if="pageCount > 1"
      class="long-manuscript-pagination long-manuscript-pagination-right"
      :aria-label="t('chapterPagination')"
    >
      <button
        type="button"
        :aria-label="t('previousPage')"
        :title="t('previousPage')"
        :disabled="page === 1"
        @click="setPage(page - 1)"
      >
        <AppIcon name="arrow-left" :size="13" />
      </button>
      <span>{{ t("pageOf", { page, pages: pageCount }) }}</span>
      <button
        type="button"
        :aria-label="t('nextPage')"
        :title="t('nextPage')"
        :disabled="page === pageCount"
        @click="setPage(page + 1)"
      >
        <AppIcon name="arrow-right" :size="13" />
      </button>
    </div>
  </aside>
</template>

<style>
.long-manuscript-pagination {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  color: var(--text-tertiary);
  font-size: 0.64rem;
  white-space: nowrap;
}

.long-manuscript-pagination button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.long-manuscript-pagination button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.long-manuscript-pagination button:disabled {
  cursor: default;
  opacity: 0.35;
}

.long-manuscript-pagination-right {
  justify-content: center;
  padding: 6px 0 8px;
}
</style>
