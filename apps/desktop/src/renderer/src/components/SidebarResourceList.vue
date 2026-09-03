<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  BookResourceDialogMode,
  CatalogLibraryEntryDragPayload,
  CatalogResourceNodeActionPayload,
  CreationBookDragPayload,
  LongBookResourceNodeActionPayload,
  LongTreeItemAction,
  ResourceDomain,
  ResourceSectionActionPayload,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import { useCreationResourceOrder } from "../composables/useCreationResourceOrder";
import {
  collectPinnedResourceNodes,
  excludePinnedResourceNodes,
  flattenResourceNodes,
  parsePinnedResourceIds,
  pinnableResourceNodes,
  PINNED_RESOURCE_STORAGE_KEY
} from "../utils/pinnedResources";
import AppIcon from "./AppIcon.vue";
import TreeNodeItem from "./TreeNodeItem.vue";
import TreeSection from "./TreeSection.vue";

const props = defineProps<{
  sections: ResourceTreeSection[];
  selectedId: string;
  libraryEntryClipboardDomain?: "skill" | "material" | undefined;
  longTreeActionsDisabled?: boolean;
}>();

const emit = defineEmits<{
  selectResource: [node: ResourceTreeNode];
  bookAction: [mode: BookResourceDialogMode, node: ResourceTreeNode];
  exportBook: [node: ResourceTreeNode];
  longBookAction: [payload: LongBookResourceNodeActionPayload];
  resourceAction: [payload: ResourceSectionActionPayload];
  resourceNodeAction: [payload: CatalogResourceNodeActionPayload];
  moveLibraryEntry: [payload: CatalogLibraryEntryDragPayload];
  createExpertSection: [node: ResourceTreeNode];
  createLongDraftSection: [node: ResourceTreeNode];
  longDraftSectionAction: [
    action: "move-up" | "move-down" | "delete",
    node: ResourceTreeNode
  ];
  createLongTreeItem: [node: ResourceTreeNode];
  longTreeItemAction: [action: LongTreeItemAction, node: ResourceTreeNode];
  deleteLongLedgerCommit: [node: ResourceTreeNode];
  removeExpertSection: [node: ResourceTreeNode];
  expertSectionAction: [
    action: "move-up" | "move-down",
    node: ResourceTreeNode
  ];
  createCharacterItem: [node: ResourceTreeNode];
  characterItemAction: [
    action: "rename" | "move-up" | "move-down" | "delete",
    node: ResourceTreeNode
  ];
}>();

const creationOrder = useCreationResourceOrder({
  sections: () => props.sections,
  storage: () => window.localStorage,
  warning: (message) => uiMessage.warning(message)
});

function loadPinnedResourceIds(): string[] {
  try {
    const stored = localStorage.getItem(PINNED_RESOURCE_STORAGE_KEY);
    if (pinnableResourceNodes(creationOrder.orderedSections.value).length) {
      return parsePinnedResourceIds(
        stored,
        creationOrder.orderedSections.value
      );
    }
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter((id): id is string => typeof id === "string")
          )
        ]
      : [];
  } catch {
    return [];
  }
}

const pinnedResourceIds = ref(loadPinnedResourceIds());
const pinnedResourceNodes = computed(() =>
  collectPinnedResourceNodes(
    creationOrder.orderedSections.value,
    pinnedResourceIds.value
  )
);
const unpinnedSections = computed(() =>
  excludePinnedResourceNodes(
    creationOrder.orderedSections.value,
    pinnedResourceIds.value
  )
);
const resourceDomainsByNodeId = computed(
  () =>
    new Map(
      creationOrder.orderedSections.value.flatMap((section) =>
        flattenResourceNodes(section.nodes).map(
          (node) => [node.id, section.id] as const
        )
      )
    )
);

function toggleResourcePin(node: ResourceTreeNode): void {
  const pinned = pinnedResourceIds.value.includes(node.id);
  pinnedResourceIds.value = pinned
    ? pinnedResourceIds.value.filter((id) => id !== node.id)
    : [...pinnedResourceIds.value, node.id];
  try {
    localStorage.setItem(
      PINNED_RESOURCE_STORAGE_KEY,
      JSON.stringify(pinnedResourceIds.value)
    );
  } catch {
    uiMessage.warning("置顶状态暂时无法保存，但本次操作仍然有效");
  }
  uiMessage.success(
    pinned ? `已取消置顶“${node.label}”` : `已置顶“${node.label}”`
  );
}

function resourceDomainFor(node: ResourceTreeNode): ResourceDomain {
  return resourceDomainsByNodeId.value.get(node.id) ?? "creation";
}

function reorderCreationBook(payload: CreationBookDragPayload): void {
  creationOrder.reorder(payload);
}

watch(
  () =>
    pinnableResourceNodes(creationOrder.orderedSections.value).map(
      (node) => node.id
    ),
  (validIds) => {
    const validIdSet = new Set(validIds);
    if (validIdSet.size === 0) return;
    const nextIds = pinnedResourceIds.value.filter((id) => validIdSet.has(id));
    if (nextIds.length === pinnedResourceIds.value.length) return;
    pinnedResourceIds.value = nextIds;
    try {
      localStorage.setItem(
        PINNED_RESOURCE_STORAGE_KEY,
        JSON.stringify(nextIds)
      );
    } catch {
      // The in-memory state is still kept in sync when storage is unavailable.
    }
  }
);
</script>

<template>
  <div class="resource-list">
    <section
      v-if="pinnedResourceNodes.length"
      class="resource-section pinned-resource-section"
    >
      <div class="pinned-resource-heading">
        <AppIcon name="pin" :size="15" />
        <span>置顶</span>
      </div>
      <ul
        class="resource-tree pinned-resource-tree"
        aria-label="置顶的书籍、技能库和素材库"
      >
        <TreeNodeItem
          v-for="node in pinnedResourceNodes"
          :key="node.id"
          :node="node"
          :depth="0"
          :selected-id="selectedId"
          pinnable
          pinned
          :pinned-ids="pinnedResourceIds"
          :resource-domain="resourceDomainFor(node)"
          :library-entry-clipboard-domain="libraryEntryClipboardDomain"
          :long-tree-actions-disabled="longTreeActionsDisabled"
          @select="emit('selectResource', $event)"
          @toggle-pin="toggleResourcePin"
          @book-action="(mode, book) => emit('bookAction', mode, book)"
          @export-book="emit('exportBook', $event)"
          @long-book-action="emit('longBookAction', $event)"
          @resource-node-action="emit('resourceNodeAction', $event)"
          @move-library-entry="emit('moveLibraryEntry', $event)"
          @create-expert-section="emit('createExpertSection', $event)"
          @create-long-draft-section="emit('createLongDraftSection', $event)"
          @long-draft-section-action="
            (action, sectionNode) =>
              emit('longDraftSectionAction', action, sectionNode)
          "
          @create-long-tree-item="emit('createLongTreeItem', $event)"
          @long-tree-item-action="
            (action, itemNode) => emit('longTreeItemAction', action, itemNode)
          "
          @delete-long-ledger-commit="emit('deleteLongLedgerCommit', $event)"
          @remove-expert-section="emit('removeExpertSection', $event)"
          @expert-section-action="
            (action, sectionNode) =>
              emit('expertSectionAction', action, sectionNode)
          "
          @create-character-item="emit('createCharacterItem', $event)"
          @character-item-action="
            (action, itemNode) => emit('characterItemAction', action, itemNode)
          "
        />
      </ul>
    </section>

    <TreeSection
      v-for="section in unpinnedSections"
      :key="section.id"
      :section="section"
      :selected-id="selectedId"
      :long-tree-actions-disabled="longTreeActionsDisabled"
      :pinned-ids="pinnedResourceIds"
      :library-entry-clipboard-domain="libraryEntryClipboardDomain"
      @select="emit('selectResource', $event)"
      @toggle-pin="toggleResourcePin"
      @book-action="(mode, book) => emit('bookAction', mode, book)"
      @export-book="emit('exportBook', $event)"
      @long-book-action="emit('longBookAction', $event)"
      @resource-action="emit('resourceAction', $event)"
      @resource-node-action="emit('resourceNodeAction', $event)"
      @move-library-entry="emit('moveLibraryEntry', $event)"
      @reorder-creation-book="reorderCreationBook"
      @create-expert-section="emit('createExpertSection', $event)"
      @create-long-draft-section="emit('createLongDraftSection', $event)"
      @long-draft-section-action="
        (action, sectionNode) =>
          emit('longDraftSectionAction', action, sectionNode)
      "
      @create-long-tree-item="emit('createLongTreeItem', $event)"
      @long-tree-item-action="
        (action, itemNode) => emit('longTreeItemAction', action, itemNode)
      "
      @delete-long-ledger-commit="emit('deleteLongLedgerCommit', $event)"
      @remove-expert-section="emit('removeExpertSection', $event)"
      @expert-section-action="
        (action, sectionNode) =>
          emit('expertSectionAction', action, sectionNode)
      "
      @create-character-item="emit('createCharacterItem', $event)"
      @character-item-action="
        (action, itemNode) => emit('characterItemAction', action, itemNode)
      "
    />
  </div>
</template>
