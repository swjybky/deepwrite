<script setup lang="ts">
import { useLibraryOrderDrag } from "../composables/useLibraryOrderDrag";
import { createScopedTranslator } from "../i18n";
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  BookResourceDialogMode,
  CatalogResourceNodeActionPayload,
  CatalogLibraryEntryDragPayload,
  CreationBookDragPayload,
  IconName,
  LongBookResourceNodeActionPayload,
  LongTreeItemAction,
  ResourceSectionAction,
  ResourceSectionActionPayload,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import TreeNodeItem from "./TreeNodeItem.vue";
import { useCreationBookDrag } from "../composables/useCreationBookDrag";
import { useTreeNodeDisclosure } from "../composables/useTreeNodeDisclosure";
import { SIDEBAR_SELECTION_ACTIVE } from "../composables/sidebarSelectionContext";

const t = createScopedTranslator("components.treeSection");

const props = defineProps<{
  section: ResourceTreeSection;
  selectedId: string;
  pinnedIds?: string[];
  libraryEntryClipboardDomain?: "skill" | "material" | undefined;
  longTreeActionsDisabled?: boolean;
}>();

const emit = defineEmits<{
  select: [node: ResourceTreeNode];
  togglePin: [node: ResourceTreeNode];
  bookAction: [mode: BookResourceDialogMode, node: ResourceTreeNode];
  exportBook: [node: ResourceTreeNode];
  longBookAction: [payload: LongBookResourceNodeActionPayload];
  resourceAction: [payload: ResourceSectionActionPayload];
  resourceNodeAction: [payload: CatalogResourceNodeActionPayload];
  moveLibraryEntry: [payload: CatalogLibraryEntryDragPayload];
  reorderCreationBook: [payload: CreationBookDragPayload];
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

const libraryOrderDrag = useLibraryOrderDrag(
  () => props.section,
  (payload) => emit("resourceNodeAction", payload)
);

const { open } = useTreeNodeDisclosure(
  () => ({
    id: props.section.id,
    label: props.section.label,
    children: props.section.nodes
  }),
  () => props.selectedId,
  {
    initialOpen: true,
    selectionActive: inject(SIDEBAR_SELECTION_ACTIVE, ref(true))
  }
);
const collapsed = computed({
  get: () => !open.value,
  set: (value: boolean) => {
    open.value = !value;
  }
});
const actionMenuOpen = ref(false);
const actionArea = ref<HTMLElement | null>(null);
const creationBookDrag = useCreationBookDrag(
  () => props.section.id,
  (payload) => emit("reorderCreationBook", payload)
);

const actionItems = computed<
  Array<{
    id: ResourceSectionAction;
    label: string;
    icon: IconName;
  }>
>(() => {
  const resourceName =
    props.section.id === "creation"
      ? t("book")
      : props.section.id === "skill"
        ? t("skillLibrary")
        : t("materialLibrary");
  return [
    ...(props.section.id === "creation"
      ? []
      : [
          {
            id: "create-entry" as const,
            label: t("newEntry"),
            icon: "plus" as const
          }
        ]),
    {
      id: "create",
      label:
        props.section.id === "creation"
          ? t("newWork")
          : t("newValue", { arg0: resourceName }),
      icon: "plus"
    },
    ...(props.section.id === "creation"
      ? ([
          {
            id: "create-from-template",
            label: t("createFromTemplate"),
            icon: "plus"
          }
        ] as const)
      : []),
    ...(props.section.id === "creation"
      ? []
      : ([
          {
            id: "create-group",
            label: t("newGroup"),
            icon: "folder"
          }
        ] as const)),
    {
      id: props.section.id === "creation" ? "choose-open-book" : "import",
      label:
        props.section.id === "creation"
          ? t("openExistingWork")
          : t("openExistingValue", {
              arg0: resourceName
            }),
      icon: "folder"
    },
    ...(props.section.id === "creation"
      ? ([
          {
            id: "choose-import-book",
            label: t("importExistingWork"),
            icon: "archive"
          },
          {
            id: "refresh-long-books",
            label: t("refreshNovels"),
            icon: "history"
          }
        ] as const)
      : []),
    ...(props.section.id === "creation"
      ? []
      : ([
          {
            id: "import-library-package",
            label:
              props.section.id === "skill"
                ? t("importSkillPackage")
                : t("importMaterialPackage"),
            icon: "archive"
          },
          {
            id: "import-external-library",
            label: t("importValueFromFilesOrFolders", {
              arg0: props.section.id === "skill" ? t("skill") : t("material")
            }),
            icon: "download"
          }
        ] as const))
  ];
});

function activateResourceAction(action: ResourceSectionAction): void {
  actionMenuOpen.value = false;
  emit("resourceAction", { domain: props.section.id, action });
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (actionArea.value?.contains(event.target as Node)) {
    return;
  }
  actionMenuOpen.value = false;
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    actionMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
});
</script>

<template>
  <section
    class="resource-section"
    :class="{ 'is-collapsed': collapsed }"
    @pointerdown="libraryOrderDrag.start"
    @click.capture="libraryOrderDrag.click"
  >
    <div class="resource-section-heading">
      <button
        class="section-toggle"
        type="button"
        :aria-expanded="!collapsed"
        :aria-label="
          collapsed
            ? t('expandValue', { arg0: section.label })
            : t('collapseValue', { arg0: section.label })
        "
        @click="collapsed = !collapsed"
      >
        <AppIcon :name="section.icon" :size="15" />
        <span>{{ section.label }}</span>
        <AppIcon class="section-toggle-chevron" name="chevron" :size="13" />
      </button>
      <div ref="actionArea" class="section-action-area">
        <button
          class="section-action"
          :class="{ 'is-active': actionMenuOpen }"
          type="button"
          :aria-label="
            t('createOrImportValue', {
              arg0: section.label
            })
          "
          :aria-expanded="actionMenuOpen"
          aria-haspopup="menu"
          @click="actionMenuOpen = !actionMenuOpen"
        >
          <AppIcon name="plus" :size="14" />
        </button>

        <div v-if="actionMenuOpen" class="section-action-menu" role="menu">
          <button
            v-for="item in actionItems"
            :key="item.id"
            class="section-action-menu-item"
            type="button"
            role="menuitem"
            :data-resource-action="`${section.id}-${item.id}`"
            @click="activateResourceAction(item.id)"
          >
            <AppIcon :name="item.icon" :size="17" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>

    <ul
      v-if="!collapsed"
      class="resource-tree"
      :aria-label="t('contentUnderValue', { arg0: section.label })"
    >
      <TreeNodeItem
        v-for="node in section.nodes"
        :key="node.id"
        :node="node"
        :depth="0"
        :selected-id="selectedId"
        :pinnable="
          !node.unavailable &&
          !node.missing &&
          (node.catalogNodeType === 'book' ||
            node.catalogNodeType === 'library')
        "
        :pinned="pinnedIds?.includes(node.id) ?? false"
        :pinned-ids="pinnedIds"
        :resource-domain="section.id"
        :library-entry-clipboard-domain="libraryEntryClipboardDomain"
        :long-tree-actions-disabled="longTreeActionsDisabled"
        :creation-book-draggable="creationBookDrag.canDrag(node)"
        :class="creationBookDrag.dropClass(node)"
        @dragstart="creationBookDrag.start($event, node)"
        @dragover="creationBookDrag.over($event, node)"
        @dragleave="creationBookDrag.leave($event, node)"
        @drop="creationBookDrag.drop($event, node)"
        @dragend="creationBookDrag.end"
        @select="emit('select', $event)"
        @toggle-pin="emit('togglePin', $event)"
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
</template>

<style scoped>
:deep(.library-order-source) {
  opacity: 0.32;
  background: var(--surface-muted);
  outline: 1px dashed var(--theme-line);
  outline-offset: -1px;
}
:global(.tree-row.library-order-ghost) {
  z-index: 10000;
  pointer-events: none;
  margin: 0;
  background: var(--surface-raised);
  color: var(--text-primary);
  box-shadow:
    0 0 0 1px var(--theme-line),
    0 8px 24px color-mix(in srgb, var(--theme-foreground) 18%, transparent);
}
:global(html.library-order-dragging),
:global(html.library-order-dragging *) {
  cursor: grabbing !important;
  user-select: none !important;
}
:deep(.library-order-before) {
  box-shadow: 0 -2px 0 var(--accent);
}
:deep(.library-order-after) {
  box-shadow: 0 2px 0 var(--accent);
}
</style>
