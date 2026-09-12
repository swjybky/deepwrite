<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type {
  BookResourceDialogMode,
  CatalogResourceNodeAction,
  CatalogResourceNodeActionPayload,
  CatalogLibraryEntryDragPayload,
  LongBookResourceNodeAction,
  LongBookResourceNodeActionPayload,
  LongTreeItemAction,
  ResourceDomain,
  ResourceTreeNode
} from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import LongBookActionMenu from "./LongBookActionMenu.vue";

defineOptions({ name: "TreeNodeItem" });

const props = defineProps<{
  node: ResourceTreeNode;
  depth: number;
  selectedId: string;
  pinnable?: boolean;
  pinned?: boolean;
  pinnedIds?: string[] | undefined;
  resourceDomain?: ResourceDomain | undefined;
  libraryEntryClipboardDomain?: "skill" | "material" | undefined;
  creationBookDraggable?: boolean;
  expertSectionMoveUpDisabled?: boolean;
  expertSectionMoveDownDisabled?: boolean;
  longDraftSectionMoveUpDisabled?: boolean;
  longDraftSectionMoveDownDisabled?: boolean;
  longTreeItemMoveUpDisabled?: boolean;
  longTreeItemMoveDownDisabled?: boolean;
  longTreeActionsDisabled?: boolean;
}>();

const emit = defineEmits<{
  select: [node: ResourceTreeNode];
  togglePin: [node: ResourceTreeNode];
  bookAction: [mode: BookResourceDialogMode, node: ResourceTreeNode];
  exportBook: [node: ResourceTreeNode];
  longBookAction: [payload: LongBookResourceNodeActionPayload];
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

const open = ref(
  Boolean(props.node.selectableBranch && props.selectedId === props.node.id)
);
const ACTION_MENU_GAP = 3;
const ACTION_MENU_EDGE_GAP = 8;
const actionMenuOpen = ref(false);
const actionArea = ref<HTMLElement | null>(null);
const actionMenu = ref<HTMLElement | null>(null);
const actionMenuOpensUpward = ref(false);
const libraryDomain = computed<"skill" | "material" | undefined>(() =>
  props.resourceDomain === "skill" || props.resourceDomain === "material"
    ? props.resourceDomain
    : undefined
);
const canPasteLibraryEntry = computed(
  () =>
    libraryDomain.value !== undefined &&
    props.libraryEntryClipboardDomain === libraryDomain.value
);
const hasLibraryAction = computed(
  () =>
    libraryDomain.value !== undefined &&
    ((props.node.catalogNodeType === "library" && !props.node.missing) ||
      (props.node.catalogNodeType === "document" &&
        Boolean(props.node.catalogEntryId)))
);
const hasGroupAction = computed(
  () =>
    libraryDomain.value !== undefined &&
    props.node.catalogNodeType === "group" &&
    Boolean(props.node.groupId)
);
const hasBookAction = computed(
  () =>
    props.resourceDomain === "creation" && props.node.catalogNodeType === "book"
);
const hasLongBookAction = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.catalogNodeType === "long-book" &&
    props.node.workspaceType === "long" &&
    Boolean(props.node.longBookId)
);
const isExpertDraftParent = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.stageCategoryId === "draft" &&
    !props.node.expertSectionId
);
const isLongDraftVolume = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.workspaceType === "long" &&
    Boolean(props.node.longDraftVolumeId)
);
const isLongDraftSection = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.workspaceType === "long" &&
    props.node.longWorkspaceSelection?.root === "draft" &&
    Boolean(props.node.longWorkspaceSelection?.chapterCardId)
);
const isLongTreeCollection = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.workspaceType === "long" &&
    Boolean(props.node.longTreeCollection)
);
const isLongTreeItem = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.workspaceType === "long" &&
    Boolean(props.node.longTreeItem)
);
const isLongLedgerCommit = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.workspaceType === "long" &&
    Boolean(props.node.longLedgerCommit)
);
const isExpertDraftSection = computed(
  () =>
    props.resourceDomain === "creation" && Boolean(props.node.expertSectionId)
);
const isCharacterDirectory = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.characterDirectory === true
);
const isCharacterItem = computed(
  () =>
    props.resourceDomain === "creation" && Boolean(props.node.characterItemId)
);
const hasActionMenu = computed(
  () =>
    Boolean(props.pinnable) ||
    hasLibraryAction.value ||
    hasGroupAction.value ||
    hasBookAction.value ||
    hasLongBookAction.value ||
    isLongLedgerCommit.value ||
    isLongTreeItem.value ||
    isLongDraftSection.value ||
    isExpertDraftSection.value ||
    isCharacterItem.value
);
const hasNodeAction = computed(
  () =>
    hasActionMenu.value ||
    isLongTreeCollection.value ||
    isLongDraftVolume.value ||
    isExpertDraftParent.value ||
    isCharacterDirectory.value
);
const canDragLibraryEntry = computed(
  () =>
    libraryDomain.value !== undefined &&
    props.node.catalogNodeType === "document" &&
    Boolean(props.node.libraryId && props.node.catalogEntryId) &&
    !props.node.readOnly &&
    !props.node.unavailable
);
const dragPayload = ref<{
  domain: "skill" | "material";
  sourceLibraryId: string;
  entryId: string;
} | null>(null);
const isDropTarget = ref(false);
const draftUnitLabel = computed(() =>
  props.node.workspaceType === "script" ? "剧集" : "小节"
);

function containsSelectedDescendant(
  node: ResourceTreeNode,
  selectedId: string
): boolean {
  return (node.children ?? []).some(
    (child) =>
      child.id === selectedId || containsSelectedDescendant(child, selectedId)
  );
}

function isFirstLongTreeItem(node: ResourceTreeNode): boolean {
  const kind = node.longTreeItem?.kind;
  if (!kind) return false;
  return (
    props.node.children?.find(
      (candidate) => candidate.longTreeItem?.kind === kind
    )?.id === node.id
  );
}

function isLastLongTreeItem(node: ResourceTreeNode): boolean {
  const kind = node.longTreeItem?.kind;
  if (!kind) return false;
  const siblings =
    props.node.children?.filter(
      (candidate) => candidate.longTreeItem?.kind === kind
    ) ?? [];
  return siblings.at(-1)?.id === node.id;
}

watch(
  () => [props.selectedId, props.node.children?.length ?? 0] as const,
  ([selectedId, childCount]) => {
    if (
      childCount > 0 &&
      ((props.node.selectableBranch && selectedId === props.node.id) ||
        (selectedId && containsSelectedDescendant(props.node, selectedId)))
    ) {
      open.value = true;
    }
  },
  { immediate: true }
);

function activate(): void {
  if (props.node.unavailable && props.node.catalogNodeType === "long-book") {
    return;
  }
  if (props.node.children?.length) {
    open.value = !open.value;
    if (props.node.selectableBranch) {
      emit("select", props.node);
    }
    return;
  }
  emit("select", props.node);
}

function togglePin(): void {
  actionMenuOpen.value = false;
  emit("togglePin", props.node);
}

function updateActionMenuPlacement(): void {
  const area = actionArea.value;
  const menu = actionMenu.value;
  if (!actionMenuOpen.value || !area || !menu) return;

  const scrollContainer = area.closest<HTMLElement>(".sidebar-scroll");
  const viewportHeight =
    document.documentElement.clientHeight || window.innerHeight;
  const scrollBounds = scrollContainer?.getBoundingClientRect();
  const boundaryTop =
    Math.max(scrollBounds?.top ?? 0, 0) + ACTION_MENU_EDGE_GAP;
  const boundaryBottom =
    Math.min(scrollBounds?.bottom ?? viewportHeight, viewportHeight) -
    ACTION_MENU_EDGE_GAP;
  const areaBounds = area.getBoundingClientRect();
  const menuHeight = menu.getBoundingClientRect().height;
  const availableBelow = boundaryBottom - areaBounds.bottom - ACTION_MENU_GAP;
  const availableAbove = areaBounds.top - boundaryTop - ACTION_MENU_GAP;

  actionMenuOpensUpward.value =
    menuHeight > availableBelow && availableAbove > availableBelow;
}

function toggleActionMenu(): void {
  const willOpen = !actionMenuOpen.value;
  if (willOpen) actionMenuOpensUpward.value = false;
  actionMenuOpen.value = willOpen;
  if (willOpen) void nextTick(updateActionMenuPlacement);
}

function openBookAction(mode: BookResourceDialogMode): void {
  actionMenuOpen.value = false;
  emit("bookAction", mode, props.node);
}

function exportBook(): void {
  actionMenuOpen.value = false;
  emit("exportBook", props.node);
}

function activateLongBookAction(action: LongBookResourceNodeAction): void {
  const node = props.node;
  if (
    node.catalogNodeType !== "long-book" ||
    node.workspaceType !== "long" ||
    !node.longBookId
  ) {
    return;
  }
  actionMenuOpen.value = false;
  emit("longBookAction", {
    action,
    node: node as LongBookResourceNodeActionPayload["node"]
  });
}

function activateResourceNodeAction(action: CatalogResourceNodeAction): void {
  const domain = libraryDomain.value;
  if (!domain) return;
  actionMenuOpen.value = false;
  emit("resourceNodeAction", { domain, action, node: props.node });
}

function startLibraryEntryDrag(event: DragEvent): void {
  const domain = libraryDomain.value;
  if (!domain || !props.node.libraryId || !props.node.catalogEntryId) return;
  dragPayload.value = {
    domain,
    sourceLibraryId: props.node.libraryId,
    entryId: props.node.catalogEntryId
  };
  event.dataTransfer?.setData(
    "application/x-deepwrite-library-entry",
    JSON.stringify(dragPayload.value)
  );
  event.dataTransfer?.setData(
    `application/x-deepwrite-library-entry-${domain}`,
    "1"
  );
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function readLibraryEntryDrag(event: DragEvent): {
  domain: "skill" | "material";
  sourceLibraryId: string;
  entryId: string;
} | null {
  try {
    const value = JSON.parse(
      event.dataTransfer?.getData("application/x-deepwrite-library-entry") ?? ""
    ) as typeof dragPayload.value;
    return value &&
      value.domain === libraryDomain.value &&
      value.sourceLibraryId &&
      value.entryId
      ? value
      : null;
  } catch {
    return null;
  }
}

function handleLibraryEntryDragOver(event: DragEvent): void {
  const source = readLibraryEntryDrag(event);
  const domain = libraryDomain.value;
  const targetLibraryId =
    props.node.catalogNodeType === "library"
      ? props.node.libraryId
      : props.node.catalogNodeType === "document"
        ? props.node.libraryId
        : undefined;
  const matchingDragType = domain
    ? Array.from(event.dataTransfer?.types ?? []).includes(
        `application/x-deepwrite-library-entry-${domain}`
      )
    : false;
  if (
    (!source && !matchingDragType) ||
    !domain ||
    !targetLibraryId ||
    props.node.readOnly ||
    props.node.unavailable
  )
    return;
  event.preventDefault();
  isDropTarget.value = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function clearLibraryEntryDropTarget(): void {
  isDropTarget.value = false;
}

function dropLibraryEntry(event: DragEvent): void {
  const source = readLibraryEntryDrag(event);
  const domain = libraryDomain.value;
  const targetLibraryId =
    props.node.catalogNodeType === "library"
      ? props.node.libraryId
      : props.node.catalogNodeType === "document"
        ? props.node.libraryId
        : undefined;
  isDropTarget.value = false;
  if (
    !source ||
    !domain ||
    !targetLibraryId ||
    props.node.readOnly ||
    props.node.unavailable
  )
    return;
  event.preventDefault();
  const beforeEntryId =
    props.node.catalogNodeType === "document"
      ? props.node.catalogEntryId
      : undefined;
  if (
    source.sourceLibraryId === targetLibraryId &&
    source.entryId === beforeEntryId
  )
    return;
  emit("moveLibraryEntry", {
    domain,
    sourceLibraryId: source.sourceLibraryId,
    entryId: source.entryId,
    targetLibraryId,
    ...(beforeEntryId ? { beforeEntryId } : {})
  });
}

function createExpertSection(): void {
  emit("select", props.node);
  emit("createExpertSection", props.node);
}

function createLongDraftSection(): void {
  emit("select", props.node);
  emit("createLongDraftSection", props.node);
}

function longDraftSectionAction(
  action: "move-up" | "move-down" | "delete"
): void {
  actionMenuOpen.value = false;
  emit("select", props.node);
  emit("longDraftSectionAction", action, props.node);
}

function createLongTreeItem(): void {
  emit("createLongTreeItem", props.node);
}

function longTreeItemAction(action: LongTreeItemAction): void {
  actionMenuOpen.value = false;
  emit("longTreeItemAction", action, props.node);
}

function deleteLongLedgerCommit(): void {
  actionMenuOpen.value = false;
  emit("deleteLongLedgerCommit", props.node);
}

function removeExpertSection(): void {
  actionMenuOpen.value = false;
  emit("select", props.node);
  emit("removeExpertSection", props.node);
}

function expertSectionAction(action: "move-up" | "move-down"): void {
  actionMenuOpen.value = false;
  emit("select", props.node);
  emit("expertSectionAction", action, props.node);
}

function createCharacterItem(): void {
  emit("select", props.node);
  emit("createCharacterItem", props.node);
}

function characterItemAction(
  action: "rename" | "move-up" | "move-down" | "delete"
): void {
  actionMenuOpen.value = false;
  emit("select", props.node);
  emit("characterItemAction", action, props.node);
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!actionArea.value?.contains(event.target as Node)) {
    actionMenuOpen.value = false;
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    actionMenuOpen.value = false;
  }
}

onMounted(() => {
  if (!hasActionMenu.value) {
    return;
  }
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
  window.addEventListener("resize", updateActionMenuPlacement);
});

onBeforeUnmount(() => {
  if (!hasActionMenu.value) {
    return;
  }
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
  window.removeEventListener("resize", updateActionMenuPlacement);
});
</script>

<template>
  <li class="tree-node">
    <button
      class="tree-row"
      :class="{
        'is-selected': selectedId === node.id,
        'is-muted': node.muted,
        'has-node-action': hasNodeAction,
        'is-library-entry-drop-target': isDropTarget
      }"
      :style="{ '--tree-depth': depth }"
      :data-tree-depth="depth"
      type="button"
      :title="
        node.categoryTag ? `${node.label} · ${node.categoryTag}` : node.label
      "
      :data-resource-id="node.id"
      :aria-expanded="node.children?.length ? open : undefined"
      :aria-label="`${node.children?.length ? `${node.selectableBranch ? '选择并' : ''}${open ? '折叠' : '展开'}` : ''}${node.label}${node.categoryTag ? `，${node.categoryTag}` : ''}`"
      :draggable="canDragLibraryEntry || creationBookDraggable"
      @click="activate"
      @dragstart="startLibraryEntryDrag"
      @dragover="handleLibraryEntryDragOver"
      @dragleave="clearLibraryEntryDropTarget"
      @drop="dropLibraryEntry"
    >
      <AppIcon
        :name="node.icon ?? (node.children?.length ? 'folder' : 'file')"
        :size="15"
      />
      <span class="tree-label">{{ node.label }}</span>
      <span v-if="node.categoryTag" class="tree-category-tag">{{
        node.categoryTag
      }}</span>
      <span v-if="node.badge" class="tree-badge">
        {{ node.badge }}
      </span>
      <span
        v-if="node.children?.length"
        class="tree-chevron"
        :class="{ 'is-open': open }"
      >
        <AppIcon name="chevron" :size="13" />
      </span>
    </button>

    <div
      v-if="
        isLongTreeCollection ||
        isLongDraftVolume ||
        isExpertDraftParent ||
        isCharacterDirectory
      "
      class="tree-node-action-area"
    >
      <button
        class="tree-node-action"
        type="button"
        :disabled="isLongTreeCollection && longTreeActionsDisabled"
        :aria-label="
          isCharacterDirectory
            ? '新建人物条目'
            : isLongTreeCollection
              ? `在${node.label}新增条目`
              : isLongDraftVolume
                ? `在${node.label}新增小节`
                : `在${node.label}末尾新建${draftUnitLabel}`
        "
        :title="
          isCharacterDirectory
            ? '新建人物条目'
            : isLongTreeCollection
              ? '新增条目'
              : isLongDraftVolume
                ? '新增小节'
                : `新建${draftUnitLabel}`
        "
        @click.stop="
          isCharacterDirectory
            ? createCharacterItem()
            : isLongTreeCollection
              ? createLongTreeItem()
              : isLongDraftVolume
                ? createLongDraftSection()
                : createExpertSection()
        "
      >
        <AppIcon name="plus" :size="16" />
      </button>
    </div>

    <div
      v-else-if="hasActionMenu"
      ref="actionArea"
      class="tree-node-action-area"
      :class="{ 'is-menu-open': actionMenuOpen }"
    >
      <button
        class="tree-node-action"
        :class="{ 'is-active': actionMenuOpen }"
        type="button"
        :disabled="isLongTreeItem && longTreeActionsDisabled"
        :aria-label="`${node.label}更多操作`"
        :aria-expanded="actionMenuOpen"
        aria-haspopup="menu"
        @click.stop="toggleActionMenu"
      >
        <AppIcon name="more" :size="16" />
      </button>

      <div
        v-if="actionMenuOpen"
        ref="actionMenu"
        class="tree-node-action-menu"
        :class="{ 'opens-upward': actionMenuOpensUpward }"
        role="menu"
      >
        <button
          v-if="pinnable"
          class="tree-node-action-menu-item"
          type="button"
          role="menuitem"
          @click.stop="togglePin"
        >
          <AppIcon name="pin" :size="16" />
          <span>{{ pinned ? "取消置顶" : "置顶" }}</span>
        </button>
        <template v-if="isLongLedgerCommit">
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            :disabled="
              longTreeActionsDisabled || !node.longLedgerCommit?.deletable
            "
            :title="
              node.longLedgerCommit?.deletable
                ? '删除最后一条提交记录'
                : '请先删除最后一条提交记录'
            "
            @click.stop="deleteLongLedgerCommit"
          >
            <AppIcon name="trash" :size="16" />
            <span>{{
              node.longLedgerCommit?.deletable
                ? "删除记录"
                : "删除记录（请先删除最后一条）"
            }}</span>
          </button>
        </template>
        <template v-else-if="isLongTreeItem">
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            :disabled="longTreeActionsDisabled || longTreeItemMoveUpDisabled"
            @click.stop="longTreeItemAction('move-up')"
          >
            <span>↑</span><span>上移</span>
          </button>
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            :disabled="longTreeActionsDisabled || longTreeItemMoveDownDisabled"
            @click.stop="longTreeItemAction('move-down')"
          >
            <span>↓</span><span>下移</span>
          </button>
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            :disabled="longTreeActionsDisabled"
            @click.stop="longTreeItemAction('delete')"
          >
            <AppIcon name="trash" :size="16" />
            <span>删除</span>
          </button>
        </template>
        <template v-else-if="isLongDraftSection">
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            :disabled="longDraftSectionMoveUpDisabled"
            @click.stop="longDraftSectionAction('move-up')"
          >
            <span>↑</span><span>上移</span>
          </button>
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            :disabled="longDraftSectionMoveDownDisabled"
            @click.stop="longDraftSectionAction('move-down')"
          >
            <span>↓</span><span>下移</span>
          </button>
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="longDraftSectionAction('delete')"
          >
            <AppIcon name="trash" :size="16" />
            <span>删除</span>
          </button>
        </template>
        <template v-else-if="isExpertDraftSection">
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            :disabled="expertSectionMoveUpDisabled"
            @click.stop="expertSectionAction('move-up')"
          >
            <span>↑</span><span>上移</span>
          </button>
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            :disabled="expertSectionMoveDownDisabled"
            @click.stop="expertSectionAction('move-down')"
          >
            <span>↓</span><span>下移</span>
          </button>
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="removeExpertSection"
          >
            <AppIcon name="trash" :size="16" />
            <span>删除{{ draftUnitLabel }}</span>
          </button>
        </template>
        <template v-else-if="isCharacterItem">
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="characterItemAction('rename')"
          >
            <AppIcon name="edit" :size="16" /><span>修改名称</span>
          </button>
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="characterItemAction('move-up')"
          >
            <span>↑</span><span>上移</span>
          </button>
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="characterItemAction('move-down')"
          >
            <span>↓</span><span>下移</span>
          </button>
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="characterItemAction('delete')"
          >
            <AppIcon name="trash" :size="16" /><span>删除人物条目</span>
          </button>
        </template>
        <LongBookActionMenu
          v-else-if="hasLongBookAction"
          :unavailable="node.unavailable"
          :pending="longTreeActionsDisabled"
          @action="activateLongBookAction"
        />
        <template v-else-if="hasBookAction">
          <template v-if="!node.unavailable">
            <button
              class="tree-node-action-menu-item"
              type="button"
              role="menuitem"
              @click.stop="openBookAction('manage-structure')"
            >
              <AppIcon name="settings" :size="16" />
              <span>结构管理</span>
            </button>
            <button
              class="tree-node-action-menu-item"
              type="button"
              role="menuitem"
              @click.stop="openBookAction('rename')"
            >
              <AppIcon name="edit" :size="16" />
              <span>修改名称</span>
            </button>
            <button
              class="tree-node-action-menu-item"
              type="button"
              role="menuitem"
              @click.stop="openBookAction('duplicate')"
            >
              <AppIcon name="copy" :size="16" />
              <span>复制</span>
            </button>
            <button
              class="tree-node-action-menu-item"
              type="button"
              role="menuitem"
              @click.stop="openBookAction('bind-skill')"
            >
              <AppIcon name="library" :size="16" />
              <span>技能库绑定</span>
            </button>
            <button
              class="tree-node-action-menu-item"
              type="button"
              role="menuitem"
              @click.stop="openBookAction('bind-material')"
            >
              <AppIcon name="archive" :size="16" />
              <span>素材库绑定</span>
            </button>
            <button
              class="tree-node-action-menu-item"
              type="button"
              role="menuitem"
              @click.stop="exportBook"
            >
              <AppIcon name="download" :size="16" />
              <span>导出正文</span>
            </button>
          </template>
          <div class="tree-node-action-menu-divider" role="separator" />
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="openBookAction('remove')"
          >
            <AppIcon name="trash" :size="16" />
            <span>移除</span>
          </button>
          <button
            v-if="!node.unavailable"
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="openBookAction('delete')"
          >
            <AppIcon name="trash" :size="16" />
            <span>删除</span>
          </button>
        </template>
        <template
          v-else-if="node.catalogNodeType === 'library' && libraryDomain"
        >
          <button
            v-if="!node.readOnly && !node.unavailable"
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('rename-library')"
          >
            <AppIcon name="edit" :size="16" /><span>修改名称</span>
          </button>
          <button
            v-if="!node.unavailable"
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('duplicate-library')"
          >
            <AppIcon name="copy" :size="16" />
            <span>复制</span>
          </button>
          <button
            v-if="!node.readOnly && !node.unavailable"
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('create-entry')"
          >
            <AppIcon name="plus" :size="16" />
            <span>新建条目</span>
          </button>
          <button
            v-if="
              libraryDomain === 'skill' && !node.readOnly && !node.unavailable
            "
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('import-external-skills')"
          >
            <AppIcon name="download" :size="16" />
            <span>从其他 skills 加载</span>
          </button>
          <button
            v-if="!node.readOnly && !node.unavailable && canPasteLibraryEntry"
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('paste-entry')"
          >
            <AppIcon name="copy" :size="16" />
            <span>粘贴</span>
          </button>
          <div
            v-if="pinnable"
            class="tree-node-action-menu-divider"
            role="separator"
          />
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('unregister-library')"
          >
            <AppIcon name="trash" :size="16" />
            <span>移除</span>
          </button>
          <button
            v-if="!node.unavailable"
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('delete-library')"
          >
            <AppIcon name="trash" :size="16" />
            <span>删除</span>
          </button>
        </template>
        <template v-else-if="node.catalogNodeType === 'group' && libraryDomain">
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('edit-group-bindings')"
          >
            <AppIcon name="edit" :size="16" />
            <span>编辑分组</span>
          </button>
          <button
            v-if="!node.unavailable"
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('duplicate-group')"
          >
            <AppIcon name="copy" :size="16" />
            <span>复制</span>
          </button>
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('dissolve-group')"
          >
            <AppIcon name="trash" :size="16" />
            <span>解散分组</span>
          </button>
        </template>
        <template
          v-else-if="
            node.catalogNodeType === 'document' &&
            node.catalogEntryId &&
            libraryDomain
          "
        >
          <button
            v-if="!node.readOnly"
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('rename-entry')"
          >
            <AppIcon name="edit" :size="16" /><span>修改名称</span>
          </button>
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('copy-entry')"
          >
            <AppIcon name="copy" :size="16" />
            <span>复制</span>
          </button>
          <button
            v-if="!node.readOnly"
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('remove-entry')"
          >
            <AppIcon name="trash" :size="16" />
            <span>删除条目文件</span>
          </button>
        </template>
      </div>
    </div>

    <ul v-if="node.children?.length && open" class="tree-children">
      <TreeNodeItem
        v-for="(child, childIndex) in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        :resource-domain="resourceDomain"
        :library-entry-clipboard-domain="libraryEntryClipboardDomain"
        :pinnable="
          !child.unavailable &&
          !child.missing &&
          (child.catalogNodeType === 'book' ||
            child.catalogNodeType === 'library')
        "
        :pinned="pinnedIds?.includes(child.id) ?? false"
        :pinned-ids="pinnedIds"
        :long-tree-actions-disabled="longTreeActionsDisabled"
        :expert-section-move-up-disabled="
          Boolean(child.expertSectionId) && childIndex === 0
        "
        :expert-section-move-down-disabled="
          Boolean(child.expertSectionId) &&
          childIndex === node.children.length - 1
        "
        :long-draft-section-move-up-disabled="
          child.longWorkspaceSelection?.root === 'draft' &&
          Boolean(child.longWorkspaceSelection?.chapterCardId) &&
          childIndex === 0
        "
        :long-draft-section-move-down-disabled="
          child.longWorkspaceSelection?.root === 'draft' &&
          Boolean(child.longWorkspaceSelection?.chapterCardId) &&
          childIndex === node.children.length - 1
        "
        :long-tree-item-move-up-disabled="isFirstLongTreeItem(child)"
        :long-tree-item-move-down-disabled="isLastLongTreeItem(child)"
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
  </li>
</template>

<style scoped>
.tree-node-action-area.is-menu-open {
  z-index: 30;
}

.tree-node-action-menu.opens-upward {
  top: auto;
  bottom: calc(100% + 3px);
}

.tree-node-action-menu-item:disabled {
  cursor: default;
  opacity: 0.42;
}
</style>
