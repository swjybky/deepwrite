<script setup lang="ts">
import { ref } from "vue";
import type {
  DialogMode,
  IconName,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import TreeSection from "./TreeSection.vue";

defineProps<{
  sections: ResourceTreeSection[];
  selectedId: string;
}>();

const emit = defineEmits<{
  collapse: [];
  newConversation: [];
  openDialog: [mode: DialogMode];
  openSettings: [];
  selectResource: [node: ResourceTreeNode];
}>();

const navItems: Array<{
  id: "new" | DialogMode;
  label: string;
  icon: "plus" | "directory" | "model" | "wand";
  shortcut?: string;
}> = [
  { id: "new", label: "新建对话", icon: "plus", shortcut: "Ctrl N" },
  { id: "directory", label: "工作目录", icon: "directory" },
  { id: "models", label: "模型配置", icon: "model" },
  { id: "imitation", label: "学习仿写", icon: "wand" }
];

const moreExpanded = ref(false);
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
</script>

<template>
  <aside class="left-sidebar" aria-label="DeepWrite 导航与资源树">
    <header class="sidebar-brand-row">
      <button class="brand-button" type="button" aria-label="DeepWrite 工作区菜单">
        <span class="brand-mark"><AppIcon name="logo" :size="19" /></span>
        <span class="brand-name">DeepWrite</span>
        <AppIcon name="chevron" :size="12" />
      </button>
      <button class="icon-button" type="button" aria-label="收起左侧栏" @click="emit('collapse')">
        <AppIcon name="panel-left" :size="18" />
      </button>
    </header>

    <nav class="primary-nav" aria-label="主要功能">
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
        <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
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

    <div class="sidebar-divider" />

    <div class="resource-scroll">
      <TreeSection
        v-for="section in sections"
        :key="section.id"
        :section="section"
        :selected-id="selectedId"
        @select="emit('selectResource', $event)"
      />
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
