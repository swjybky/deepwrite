<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  BookResourceDialogMode,
  CatalogResourceNodeActionPayload,
  DialogMode,
  IconName,
  ResourceDomain,
  ResourceSectionActionPayload,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import TreeSection from "./TreeSection.vue";
import TreeNodeItem from "./TreeNodeItem.vue";
import { uiMessage } from "../ui-feedback";
import {
  collectPinnedResourceNodes,
  excludePinnedResourceNodes,
  flattenResourceNodes,
  parsePinnedResourceIds,
  pinnableResourceNodes,
  PINNED_RESOURCE_STORAGE_KEY
} from "../utils/pinnedResources";

const props = defineProps<{
  sections: ResourceTreeSection[];
  selectedId: string;
}>();

const emit = defineEmits<{
  collapse: [];
  newConversation: [];
  openDialog: [mode: DialogMode];
  openSettings: [];
  selectResource: [node: ResourceTreeNode];
  bookAction: [mode: BookResourceDialogMode, node: ResourceTreeNode];
  resourceAction: [payload: ResourceSectionActionPayload];
  resourceNodeAction: [payload: CatalogResourceNodeActionPayload];
  createExpertSection: [node: ResourceTreeNode];
  removeExpertSection: [node: ResourceTreeNode];
}>();

const newConversationItem = {
  id: "new",
  label: "新建对话",
  icon: "plus",
  shortcut: "Ctrl N"
} as const;

const navItems: Array<{
  id: DialogMode;
  label: string;
  icon: "directory" | "model" | "wand";
}> = [
  { id: "directory", label: "工作目录", icon: "directory" },
  { id: "models", label: "模型配置", icon: "model" },
  { id: "imitation", label: "学习仿写", icon: "wand" }
];

function loadPinnedResourceIds(): string[] {
  try {
    const stored = localStorage.getItem(PINNED_RESOURCE_STORAGE_KEY);
    if (pinnableResourceNodes(props.sections).length) {
      return parsePinnedResourceIds(stored, props.sections);
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

const moreExpanded = ref(false);
const pinnedResourceIds = ref(loadPinnedResourceIds());
const pinnedResourceNodes = computed(() =>
  collectPinnedResourceNodes(props.sections, pinnedResourceIds.value)
);
const unpinnedSections = computed(() =>
  excludePinnedResourceNodes(props.sections, pinnedResourceIds.value)
);
const resourceDomainsByNodeId = computed(
  () =>
    new Map(
      props.sections.flatMap((section) =>
        flattenResourceNodes(section.nodes).map(
          (node) => [node.id, section.id] as const
        )
      )
    )
);
const moreFeatures: Array<{
  id: string;
  label: string;
  description: string;
  icon: IconName;
}> = [
  { id: "history", label: "版本历史", description: "查看文稿修改记录", icon: "history" },
  { id: "search", label: "全局检索", description: "搜索创作空间内容", icon: "search" },
  { id: "transfer", label: "导入与导出", description: "迁移旧项目和文稿", icon: "archive" },
  { id: "runtime", label: "运行设置", description: "智能体与工具边界", icon: "model" }
];

function activateNav(id: "new" | DialogMode): void {
  if (id === "new") {
    emit("newConversation");
    return;
  }
  emit("openDialog", id);
}

function toggleResourcePin(node: ResourceTreeNode): void {
  const pinned = pinnedResourceIds.value.includes(node.id);
  pinnedResourceIds.value = pinned
    ? pinnedResourceIds.value.filter((id) => id !== node.id)
    : [...pinnedResourceIds.value, node.id];

  try {
    localStorage.setItem(PINNED_RESOURCE_STORAGE_KEY, JSON.stringify(pinnedResourceIds.value));
  } catch {
    uiMessage.warning("置顶状态暂时无法保存，但本次操作仍然有效");
  }

  uiMessage.success(pinned ? `已取消置顶“${node.label}”` : `已置顶“${node.label}”`);
}

function resourceDomainFor(node: ResourceTreeNode): ResourceDomain {
  return resourceDomainsByNodeId.value.get(node.id) ?? "creation";
}

watch(
  () =>
    pinnableResourceNodes(props.sections).map((node) => node.id),
  (validIds) => {
    const validIdSet = new Set(validIds);
    if (validIdSet.size === 0) {
      return;
    }
    const nextIds = pinnedResourceIds.value.filter((id) => validIdSet.has(id));
    if (nextIds.length === pinnedResourceIds.value.length) {
      return;
    }
    pinnedResourceIds.value = nextIds;
    try {
      localStorage.setItem(PINNED_RESOURCE_STORAGE_KEY, JSON.stringify(nextIds));
    } catch {
      // The in-memory state is still kept in sync when storage is unavailable.
    }
  }
);
</script>

<template>
  <aside class="left-sidebar" aria-label="DeepWrite 导航与资源树">
    <header class="sidebar-brand-row">
      <button class="brand-button" type="button" aria-label="DeepWrite 工作区菜单">
        <span class="brand-mark"><AppIcon name="logo" :size="19" /></span>
        <span class="brand-name">DeepWrite</span>
      </button>
      <button class="icon-button" type="button" aria-label="收起左侧栏" @click="emit('collapse')">
        <AppIcon name="panel-left" :size="18" />
      </button>
    </header>

    <nav class="primary-nav new-conversation-nav" aria-label="新建对话">
      <button
        class="nav-row"
        type="button"
        :data-nav-id="newConversationItem.id"
        @click="activateNav(newConversationItem.id)"
      >
        <AppIcon :name="newConversationItem.icon" :size="17" />
        <span>{{ newConversationItem.label }}</span>
        <kbd>{{ newConversationItem.shortcut }}</kbd>
      </button>
    </nav>

    <div class="sidebar-scroll">
      <nav class="primary-nav scrollable-primary-nav" aria-label="主要功能">
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-row"
          type="button"
          :data-nav-id="item.id"
          @click="activateNav(item.id)"
        >
          <AppIcon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </button>

        <button
          class="nav-row more-toggle"
          :class="{ 'is-expanded': moreExpanded }"
          type="button"
          data-nav-id="more"
          :aria-expanded="moreExpanded"
          aria-controls="more-feature-list"
          @click="moreExpanded = !moreExpanded"
        >
          <AppIcon name="more" :size="17" />
          <span>更多功能</span>
          <AppIcon class="more-toggle-chevron" name="chevron" :size="13" />
        </button>

        <div v-if="moreExpanded" id="more-feature-list" class="more-feature-list">
          <button
            v-for="feature in moreFeatures"
            :key="feature.id"
            class="more-feature-row"
            type="button"
            :data-feature-id="feature.id"
            :title="feature.description"
          >
            <span class="more-feature-icon"><AppIcon :name="feature.icon" :size="15" /></span>
            <span class="more-feature-copy">
              <strong>{{ feature.label }}</strong>
              <small>{{ feature.description }}</small>
            </span>
          </button>
        </div>
      </nav>

      <div class="resource-list">
        <section v-if="pinnedResourceNodes.length" class="resource-section pinned-resource-section">
          <div class="pinned-resource-heading">
            <AppIcon name="pin" :size="15" />
            <span>置顶</span>
          </div>
          <ul class="resource-tree pinned-resource-tree" aria-label="置顶的书籍、技能库和素材库">
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
              @select="emit('selectResource', $event)"
              @toggle-pin="toggleResourcePin"
              @book-action="(mode, book) => emit('bookAction', mode, book)"
              @resource-node-action="emit('resourceNodeAction', $event)"
              @create-expert-section="emit('createExpertSection', $event)"
              @remove-expert-section="emit('removeExpertSection', $event)"
            />
          </ul>
        </section>

        <TreeSection
          v-for="section in unpinnedSections"
          :key="section.id"
          :section="section"
          :selected-id="selectedId"
          :pinned-ids="pinnedResourceIds"
          @select="emit('selectResource', $event)"
          @toggle-pin="toggleResourcePin"
          @book-action="(mode, book) => emit('bookAction', mode, book)"
          @resource-action="emit('resourceAction', $event)"
          @resource-node-action="emit('resourceNodeAction', $event)"
          @create-expert-section="emit('createExpertSection', $event)"
          @remove-expert-section="emit('removeExpertSection', $event)"
        />
      </div>
    </div>

    <footer class="sidebar-footer">
      <button class="account-row" type="button" @click="emit('openSettings')">
        <span class="avatar">作</span>
        <span class="account-copy">
          <strong>作者</strong>
        </span>
        <AppIcon name="settings" :size="16" />
      </button>
    </footer>
  </aside>
</template>
