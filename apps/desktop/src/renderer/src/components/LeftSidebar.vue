<script setup lang="ts">
import type {
  DialogMode,
  ResourceTreeNode,
  ResourceTreeSection
} from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import TreeSection from "./TreeSection.vue";

defineProps<{
  sections: ResourceTreeSection[];
  selectedId: string;
  runtimeLabel: string;
  runtimeTone: "ok" | "preview" | "degraded";
}>();

const emit = defineEmits<{
  collapse: [];
  newConversation: [];
  openDialog: [mode: DialogMode];
  selectResource: [node: ResourceTreeNode];
}>();

const navItems: Array<{
  id: "new" | DialogMode;
  label: string;
  icon: "plus" | "directory" | "model" | "wand" | "more";
  shortcut?: string;
}> = [
  { id: "new", label: "新建对话", icon: "plus", shortcut: "Ctrl N" },
  { id: "directory", label: "工作目录", icon: "directory" },
  { id: "models", label: "模型配置", icon: "model" },
  { id: "imitation", label: "学习仿写", icon: "wand" },
  { id: "more", label: "更多功能", icon: "more" }
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
      <button class="account-row" type="button">
        <span class="avatar">沈</span>
        <span class="account-copy">
          <strong>文佳 沈</strong>
          <small><span class="runtime-dot" :class="`is-${runtimeTone}`" />{{ runtimeLabel }}</small>
        </span>
        <AppIcon name="more" :size="16" />
      </button>
    </footer>
  </aside>
</template>
