<script setup lang="ts">
import type { LongBookResourceNodeAction } from "../types/workspace";
import AppIcon from "./AppIcon.vue";
defineProps<{
  unavailable?: boolean | undefined;
  pending?: boolean | undefined;
}>();
const emit = defineEmits<{ action: [action: LongBookResourceNodeAction] }>();
function activateLongBookAction(action: LongBookResourceNodeAction): void {
  emit("action", action);
}
</script>
<template>
  <template v-if="!unavailable">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('manage-structure')"
    >
      <AppIcon name="settings" :size="16" />
      <span>结构管理</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('rename')"
    >
      <AppIcon name="edit" :size="16" />
      <span>修改名称</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('duplicate')"
    >
      <AppIcon name="copy" :size="16" />
      <span>复制</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('bind-skill')"
    >
      <AppIcon name="library" :size="16" />
      <span>技能库绑定</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('bind-material')"
    >
      <AppIcon name="archive" :size="16" />
      <span>素材库绑定</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('export')"
    >
      <AppIcon name="download" :size="16" />
      <span>导出</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('sync-legacy')"
    >
      <AppIcon name="history" :size="16" />
      <span>同步旧版本</span>
    </button>
  </template>
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    :disabled="pending"
    title="保留磁盘上的修改，解决文件冲突并刷新工作区"
    @click.stop="activateLongBookAction('resolve-conflicts')"
  >
    <AppIcon name="history" :size="16" />
    <span>解决冲突</span>
  </button>
  <div class="tree-node-action-menu-divider" role="separator" />
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    @click.stop="activateLongBookAction('unregister')"
  >
    <AppIcon name="trash" :size="16" />
    <span>移除（保留文件）</span>
  </button>
  <button
    v-if="!unavailable"
    class="tree-node-action-menu-item is-danger"
    type="button"
    role="menuitem"
    @click.stop="activateLongBookAction('delete')"
  >
    <AppIcon name="trash" :size="16" />
    <span>删除本地长篇</span>
  </button>
</template>
<style scoped>
.tree-node-action-menu-item:disabled {
  cursor: default;
  opacity: 0.42;
}
</style>
