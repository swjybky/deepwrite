<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  BookResourceDialogMode,
  CatalogResourceNodeAction,
  CatalogResourceNodeActionPayload,
  ResourceDomain,
  ResourceTreeNode
} from "../types/workspace";
import AppIcon from "./AppIcon.vue";

defineOptions({ name: "TreeNodeItem" });

const props = defineProps<{
  node: ResourceTreeNode;
  depth: number;
  selectedId: string;
  pinnable?: boolean;
  pinned?: boolean;
  pinnedIds?: string[] | undefined;
  resourceDomain?: ResourceDomain | undefined;
}>();

const emit = defineEmits<{
  select: [node: ResourceTreeNode];
  togglePin: [node: ResourceTreeNode];
  bookAction: [mode: BookResourceDialogMode, node: ResourceTreeNode];
  resourceNodeAction: [payload: CatalogResourceNodeActionPayload];
  createExpertSection: [node: ResourceTreeNode];
  removeExpertSection: [node: ResourceTreeNode];
}>();

const open = ref(
  Boolean(props.node.selectableBranch && props.selectedId === props.node.id)
);
const actionMenuOpen = ref(false);
const actionArea = ref<HTMLElement | null>(null);
const libraryDomain = computed<"skill" | "material" | undefined>(() =>
  props.resourceDomain === "skill" || props.resourceDomain === "material"
    ? props.resourceDomain
    : undefined
);
const hasLibraryAction = computed(
  () =>
    libraryDomain.value !== undefined &&
    ((props.node.catalogNodeType === "library" && !props.node.missing) ||
      (props.node.catalogNodeType === "document" &&
        Boolean(props.node.catalogEntryId) &&
        !props.node.readOnly))
);
const hasBookAction = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.catalogNodeType === "book"
);
const isExpertDraftParent = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.shortAgentId === "expert_draft_coordinator" &&
    props.node.stageCategoryId === "draft"
);
const isExpertDraftSection = computed(
  () =>
    props.resourceDomain === "creation" &&
    props.node.shortAgentId === "expert_section_writer" &&
    Boolean(props.node.expertSectionId)
);
const hasActionMenu = computed(
  () =>
    Boolean(props.pinnable) ||
    hasLibraryAction.value ||
    hasBookAction.value ||
    isExpertDraftSection.value
);
const hasNodeAction = computed(
  () => hasActionMenu.value || isExpertDraftParent.value
);

function containsSelectedDescendant(node: ResourceTreeNode, selectedId: string): boolean {
  return (node.children ?? []).some(
    (child) =>
      child.id === selectedId || containsSelectedDescendant(child, selectedId)
  );
}

watch(
  () => props.selectedId,
  (selectedId) => {
    if (selectedId && containsSelectedDescendant(props.node, selectedId)) {
      open.value = true;
    }
  },
  { immediate: true }
);

function activate(): void {
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

function openBookAction(mode: BookResourceDialogMode): void {
  actionMenuOpen.value = false;
  emit("bookAction", mode, props.node);
}

function activateResourceNodeAction(action: CatalogResourceNodeAction): void {
  const domain = libraryDomain.value;
  if (!domain) return;
  actionMenuOpen.value = false;
  emit("resourceNodeAction", { domain, action, node: props.node });
}

function createExpertSection(): void {
  emit("select", props.node);
  emit("createExpertSection", props.node);
}

function removeExpertSection(): void {
  actionMenuOpen.value = false;
  emit("select", props.node);
  emit("removeExpertSection", props.node);
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
});

onBeforeUnmount(() => {
  if (!hasActionMenu.value) {
    return;
  }
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
});
</script>

<template>
  <li class="tree-node">
    <button
      class="tree-row"
      :class="{
        'is-selected': selectedId === node.id,
        'is-muted': node.muted,
        'has-node-action': hasNodeAction
      }"
      :style="{ '--tree-depth': depth }"
      :data-tree-depth="depth"
      type="button"
      :title="node.categoryTag ? `${node.label} · ${node.categoryTag}` : node.label"
      :data-resource-id="node.id"
      :aria-expanded="node.children?.length ? open : undefined"
      :aria-label="`${node.children?.length ? `${node.selectableBranch ? '选择并' : ''}${open ? '折叠' : '展开'}` : ''}${node.label}${node.categoryTag ? `，${node.categoryTag}` : ''}`"
      @click="activate"
    >
      <AppIcon :name="node.icon ?? (node.children?.length ? 'folder' : 'file')" :size="15" />
      <span class="tree-label">{{ node.label }}</span>
      <span v-if="node.categoryTag" class="tree-category-tag">{{ node.categoryTag }}</span>
      <span
        v-if="node.catalogNodeType === 'book' && node.badge"
        class="tree-badge"
      >
        {{ node.badge }}
      </span>
      <span
        v-if="node.children?.length"
        class="tree-chevron"
        :class="{ 'is-open': open }"
      >
        <AppIcon name="chevron" :size="13" />
      </span>
      <span
        v-if="node.catalogNodeType !== 'book' && node.badge"
        class="tree-badge"
      >
        {{ node.badge }}
      </span>
    </button>

    <div
      v-if="isExpertDraftParent"
      class="tree-node-action-area"
    >
      <button
        class="tree-node-action"
        type="button"
        :aria-label="`在${node.label}末尾新建小节`"
        title="新建小节"
        @click.stop="createExpertSection"
      >
        <AppIcon name="plus" :size="16" />
      </button>
    </div>

    <div v-else-if="hasActionMenu" ref="actionArea" class="tree-node-action-area">
      <button
        class="tree-node-action"
        :class="{ 'is-active': actionMenuOpen }"
        type="button"
        :aria-label="`${node.label}更多操作`"
        :aria-expanded="actionMenuOpen"
        aria-haspopup="menu"
        @click.stop="actionMenuOpen = !actionMenuOpen"
      >
        <AppIcon name="more" :size="16" />
      </button>

      <div v-if="actionMenuOpen" class="tree-node-action-menu" role="menu">
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
        <template v-if="isExpertDraftSection">
          <button
            class="tree-node-action-menu-item is-danger"
            type="button"
            role="menuitem"
            @click.stop="removeExpertSection"
          >
            <AppIcon name="trash" :size="16" />
            <span>删除小节</span>
          </button>
        </template>
        <template v-else-if="hasBookAction">
          <template v-if="!node.unavailable">
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
        </template>
        <template v-else-if="node.catalogNodeType === 'library' && libraryDomain">
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
          <div v-if="pinnable" class="tree-node-action-menu-divider" role="separator" />
          <button
            class="tree-node-action-menu-item"
            type="button"
            role="menuitem"
            @click.stop="activateResourceNodeAction('unregister-library')"
          >
            <AppIcon name="archive" :size="16" />
            <span>从列表移除（保留文件夹）</span>
          </button>
        </template>
        <template
          v-else-if="node.catalogNodeType === 'document' && node.catalogEntryId && libraryDomain"
        >
          <button
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
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        :resource-domain="resourceDomain"
        :pinnable="
          !child.unavailable &&
          !child.missing &&
          (child.catalogNodeType === 'book' || child.catalogNodeType === 'library')
        "
        :pinned="pinnedIds?.includes(child.id) ?? false"
        :pinned-ids="pinnedIds"
        @select="emit('select', $event)"
        @toggle-pin="emit('togglePin', $event)"
        @resource-node-action="emit('resourceNodeAction', $event)"
        @create-expert-section="emit('createExpertSection', $event)"
        @remove-expert-section="emit('removeExpertSection', $event)"
      />
    </ul>
  </li>
</template>
