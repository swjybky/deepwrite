<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
  imitationRunning?: boolean;
  libraryEntryClipboardDomain?: "skill" | "material" | undefined;
  activePrimaryFeature: PrimaryFeatureId | undefined;
}>();

const emit = defineEmits<{
  collapse: [];
  newConversation: [];
  openDialog: [mode: DialogMode];
  openAgentTeams: [];
  openSettings: [];
  selectResource: [node: ResourceTreeNode];
  bookAction: [mode: BookResourceDialogMode, node: ResourceTreeNode];
  exportBook: [node: ResourceTreeNode];
  resourceAction: [payload: ResourceSectionActionPayload];
  resourceNodeAction: [payload: CatalogResourceNodeActionPayload];
  createExpertSection: [node: ResourceTreeNode];
  removeExpertSection: [node: ResourceTreeNode];
}>();

const USER_NAME_STORAGE_KEY = "deepwrite:user-name:v1";
const DEFAULT_USER_NAME = "作者";
const MAX_USER_NAME_LENGTH = 30;

function loadUserName(): string {
  try {
    const storedName = localStorage.getItem(USER_NAME_STORAGE_KEY)?.trim();
    return storedName
      ? Array.from(storedName).slice(0, MAX_USER_NAME_LENGTH).join("")
      : DEFAULT_USER_NAME;
  } catch {
    return DEFAULT_USER_NAME;
  }
}

const accountMenuRoot = ref<HTMLElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const accountMenuOpen = ref(false);
const profileDialog = ref<"name" | "contact" | null>(null);
const userName = ref(loadUserName());
const userNameDraft = ref(userName.value);
const avatarInitial = computed(() => Array.from(userName.value.trim())[0] ?? "作");

function toggleAccountMenu(): void {
  accountMenuOpen.value = !accountMenuOpen.value;
}

function openNameDialog(): void {
  accountMenuOpen.value = false;
  userNameDraft.value = userName.value;
  profileDialog.value = "name";
  void nextTick(() => nameInput.value?.select());
}

function openContactDialog(): void {
  accountMenuOpen.value = false;
  profileDialog.value = "contact";
}

function closeProfileDialog(): void {
  profileDialog.value = null;
}

function saveUserName(): void {
  const nextName = userNameDraft.value.trim();
  if (!nextName) {
    uiMessage.warning("请输入用户姓名");
    nameInput.value?.focus();
    return;
  }
  if (Array.from(nextName).length > MAX_USER_NAME_LENGTH) {
    uiMessage.warning(`用户姓名不能超过 ${MAX_USER_NAME_LENGTH} 个字符`);
    nameInput.value?.focus();
    return;
  }

  userName.value = nextName;
  profileDialog.value = null;
  try {
    localStorage.setItem(USER_NAME_STORAGE_KEY, nextName);
    uiMessage.success("用户姓名已更新");
  } catch {
    uiMessage.warning("姓名暂时无法保存到本机，但本次运行中仍会显示新姓名");
  }
}

function openSettings(): void {
  accountMenuOpen.value = false;
  emit("openSettings");
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (
    accountMenuOpen.value &&
    event.target instanceof Node &&
    !accountMenuRoot.value?.contains(event.target)
  ) {
    accountMenuOpen.value = false;
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (profileDialog.value) {
    closeProfileDialog();
    return;
  }
  accountMenuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
});

const newConversationItem = {
  id: "new",
  label: "新建对话",
  icon: "plus",
  shortcut: "Ctrl N"
} as const;

type PrimaryFeatureId = DialogMode | "agent-teams";

const navItems: Array<{
  id: PrimaryFeatureId;
  label: string;
  icon: "directory" | "model" | "wand" | "brain";
}> = [
  { id: "directory", label: "工作目录", icon: "directory" },
  { id: "models", label: "模型配置", icon: "model" },
  { id: "imitation", label: "学习仿写", icon: "wand" },
  { id: "agent-teams", label: "智能体团队", icon: "brain" }
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

function activateNav(id: "new" | PrimaryFeatureId): void {
  if (id === "new") {
    emit("newConversation");
    return;
  }
  if (id === "agent-teams") {
    emit("openAgentTeams");
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
          :class="{ 'is-active': item.id === props.activePrimaryFeature }"
          type="button"
          :data-nav-id="item.id"
          :aria-current="item.id === props.activePrimaryFeature ? 'page' : undefined"
          @click="activateNav(item.id)"
        >
          <AppIcon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
          <span
            v-if="item.id === 'imitation' && props.imitationRunning"
            class="nav-background-status"
            title="学习仿写正在后台运行"
          >
            <i aria-hidden="true" />后台中
          </span>
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
              :library-entry-clipboard-domain="libraryEntryClipboardDomain"
              @select="emit('selectResource', $event)"
              @toggle-pin="toggleResourcePin"
              @book-action="(mode, book) => emit('bookAction', mode, book)"
              @export-book="emit('exportBook', $event)"
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
          :library-entry-clipboard-domain="libraryEntryClipboardDomain"
          @select="emit('selectResource', $event)"
          @toggle-pin="toggleResourcePin"
          @book-action="(mode, book) => emit('bookAction', mode, book)"
          @export-book="emit('exportBook', $event)"
          @resource-action="emit('resourceAction', $event)"
          @resource-node-action="emit('resourceNodeAction', $event)"
          @create-expert-section="emit('createExpertSection', $event)"
          @remove-expert-section="emit('removeExpertSection', $event)"
        />
      </div>
    </div>

    <footer class="sidebar-footer">
      <div class="account-controls">
        <div ref="accountMenuRoot" class="account-profile">
          <button
            class="account-row account-identity-button"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="accountMenuOpen"
            aria-controls="account-menu"
            @click="toggleAccountMenu"
          >
            <span class="avatar">{{ avatarInitial }}</span>
            <span class="account-copy">
              <strong :title="userName">{{ userName }}</strong>
            </span>
          </button>

          <div v-if="accountMenuOpen" id="account-menu" class="account-menu" role="menu">
            <button type="button" role="menuitem" @click="openSettings">
              <AppIcon name="settings" :size="16" />
              <span>设置</span>
            </button>
            <button type="button" role="menuitem" @click="openNameDialog">
              <AppIcon name="user" :size="16" />
              <span>姓名</span>
            </button>
            <button type="button" role="menuitem" @click="openContactDialog">
              <AppIcon name="message" :size="16" />
              <span>联系作者</span>
            </button>
          </div>
        </div>

        <button
          class="icon-button account-settings-button"
          type="button"
          aria-label="打开设置"
          title="设置"
          @click="openSettings"
        >
          <AppIcon name="settings" :size="16" />
        </button>
      </div>
    </footer>
  </aside>

  <Teleport to="body">
    <div
      v-if="profileDialog === 'name'"
      class="dialog-backdrop"
      @mousedown.self="closeProfileDialog"
    >
      <section
        class="workspace-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-name-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">个人信息</span>
            <h2 id="profile-name-dialog-title">设置姓名</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭"
            @click="closeProfileDialog"
          >
            ×
          </button>
        </header>

        <form class="dialog-content" @submit.prevent="saveUserName">
          <label class="profile-name-field">
            <span>用户姓名</span>
            <input
              ref="nameInput"
              v-model="userNameDraft"
              type="text"
              :maxlength="MAX_USER_NAME_LENGTH"
              autocomplete="off"
              placeholder="请输入用户姓名"
            />
          </label>
          <p class="profile-field-help">姓名会显示在左侧栏的头像旁边。</p>
          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="closeProfileDialog">
              取消
            </button>
            <button class="dialog-primary-button" type="submit">保存</button>
          </div>
        </form>
      </section>
    </div>

    <div
      v-else-if="profileDialog === 'contact'"
      class="dialog-backdrop"
      @mousedown.self="closeProfileDialog"
    >
      <section
        class="workspace-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-author-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2 id="contact-author-dialog-title">联系作者</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭"
            @click="closeProfileDialog"
          >
            ×
          </button>
        </header>

        <div class="dialog-content">
          <p class="dialog-description contact-author-description">
            如果你有任何反馈，或者想体验最新版本，请添加作者微信并加入交流群。
          </p>
          <div class="author-contact-card">
            <span>微信号</span>
            <strong>deepseekwrite</strong>
          </div>
          <div class="dialog-actions">
            <button class="dialog-primary-button" type="button" @click="closeProfileDialog">
              我知道了
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
