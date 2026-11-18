<script setup lang="ts">
import type { ResourceDomain, ResourceTreeNode } from "../../types/workspace";
import { uiMessage } from "../../ui-feedback";
import AppIcon from "../AppIcon.vue";
import { academicTreeT } from "./academicTreeLabels";
import {
  openCreateAcademicCardDialog,
  openCreateAcademicChapterDialog,
  openCreateAcademicSectionDialog,
  openDeleteAcademicCardDialog,
  openDeleteAcademicChapterDialog,
  openDeleteAcademicSectionDialog,
  openEditAcademicCardDialog,
  openEditAcademicSectionDialog,
  openExportAcademicManuscriptDialog,
  openImportAcademicCardsDialog,
  openRenameAcademicChapterDialog,
  runAcademicChapterMove,
  runAcademicSectionMove
} from "../../stores/academicWorkspaceDialog";

const props = defineProps<{
  node: ResourceTreeNode;
  resourceDomain?: ResourceDomain | undefined;
}>();

const emit = defineEmits<{
  close: [];
}>();

function handleCreateAcademicCard(): void {
  emit("close");
  const bookId = props.node.academicCollection?.bookId;
  if (bookId) openCreateAcademicCardDialog(bookId);
}

function handleImportAcademicCards(): void {
  emit("close");
  const bookId = props.node.academicCollection?.bookId;
  if (bookId) openImportAcademicCardsDialog(bookId);
}

function handleCreateAcademicChapter(): void {
  emit("close");
  const bookId = props.node.academicCollection?.bookId;
  if (bookId) openCreateAcademicChapterDialog(bookId);
}

function handleExportAcademicManuscript(): void {
  emit("close");
  const bookId = props.node.academicCollection?.bookId;
  if (bookId) openExportAcademicManuscriptDialog(bookId);
}

function handleCreateAcademicSection(chapterId?: string): void {
  emit("close");
  const bookId =
    props.node.academicCollection?.bookId ??
    props.node.academicChapterItem?.bookId;
  if (bookId) openCreateAcademicSectionDialog(bookId, chapterId);
}

async function handleCopyAcademicCiteKey(): Promise<void> {
  emit("close");
  const key = props.node.academicCardItem?.citeKey;
  if (!key) return;
  const formatted = `[${key}]`;
  try {
    await navigator.clipboard.writeText(formatted);
    uiMessage.success(academicTreeT("copiedCiteKey", { key }));
  } catch {
    uiMessage.info(formatted);
  }
}
</script>

<template>
  <template v-if="node.academicCollection?.kind === 'reference-cards'">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="handleCreateAcademicCard"
    >
      <AppIcon name="plus" :size="16" />
      <span>{{ academicTreeT("newCard") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="handleImportAcademicCards"
    >
      <AppIcon name="archive" :size="16" />
      <span>{{ academicTreeT("importCardFromMaterials") }}</span>
    </button>
  </template>
  <template v-else-if="node.academicCollection?.kind === 'manuscript-root'">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="handleCreateAcademicSection()"
    >
      <AppIcon name="plus" :size="16" />
      <span>{{ academicTreeT("newSection") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="handleCreateAcademicChapter"
    >
      <AppIcon name="folder" :size="16" />
      <span>{{ academicTreeT("newChapter") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="handleExportAcademicManuscript"
    >
      <AppIcon name="download" :size="16" />
      <span>{{ academicTreeT("exportManuscript") }}</span>
    </button>
  </template>
  <template v-else-if="node.academicChapterItem">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        handleCreateAcademicSection(node.academicChapterItem.chapterId)
      "
    >
      <AppIcon name="plus" :size="16" />
      <span>{{ academicTreeT("addSectionToChapter") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        openRenameAcademicChapterDialog(node.academicChapterItem);
      "
    >
      <AppIcon name="edit" :size="16" />
      <span>{{ academicTreeT("renameChapter") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        runAcademicChapterMove(node.academicChapterItem, 'up');
      "
    >
      <span>↑</span><span>{{ academicTreeT("moveUp") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        runAcademicChapterMove(node.academicChapterItem, 'down');
      "
    >
      <span>↓</span><span>{{ academicTreeT("moveDown") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item is-danger"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        openDeleteAcademicChapterDialog(node.academicChapterItem);
      "
    >
      <AppIcon name="trash" :size="16" />
      <span>{{ academicTreeT("deleteChapter") }}</span>
    </button>
  </template>
  <template v-else-if="resourceDomain === 'creation' && node.academicCardItem">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        openEditAcademicCardDialog(node.academicCardItem);
      "
    >
      <AppIcon name="edit" :size="16" />
      <span>{{ academicTreeT("editCard") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="handleCopyAcademicCiteKey"
    >
      <AppIcon name="copy" :size="16" />
      <span>{{ academicTreeT("copyCiteKey") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item is-danger"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        openDeleteAcademicCardDialog(node.academicCardItem);
      "
    >
      <AppIcon name="trash" :size="16" />
      <span>{{ academicTreeT("deleteCard") }}</span>
    </button>
  </template>
  <template v-else-if="node.academicSectionItem">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        openEditAcademicSectionDialog(node.academicSectionItem);
      "
    >
      <AppIcon name="edit" :size="16" />
      <span>{{ academicTreeT("editSectionMeta") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        runAcademicSectionMove(node.academicSectionItem, 'up');
      "
    >
      <span>↑</span><span>{{ academicTreeT("moveUp") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        runAcademicSectionMove(node.academicSectionItem, 'down');
      "
    >
      <span>↓</span><span>{{ academicTreeT("moveDown") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item is-danger"
      type="button"
      role="menuitem"
      @click.stop="
        emit('close');
        openDeleteAcademicSectionDialog(node.academicSectionItem);
      "
    >
      <AppIcon name="trash" :size="16" />
      <span>{{ academicTreeT("deleteSection") }}</span>
    </button>
  </template>
</template>
