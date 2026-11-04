<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { LongBookResourceNodeAction } from "../types/workspace";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.longBookActionMenu");
defineProps<{
  unavailable?: boolean | undefined;
  pending?: boolean | undefined;
}>();
const emit = defineEmits<{
  action: [action: LongBookResourceNodeAction];
  bindAgentTeams: [];
}>();
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
      <span>{{ t("manageStructure") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('rename')"
    >
      <AppIcon name="edit" :size="16" />
      <span>{{ t("rename") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('duplicate')"
    >
      <AppIcon name="copy" :size="16" />
      <span>{{ t("duplicate") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('bind-skill')"
    >
      <AppIcon name="library" :size="16" />
      <span>{{ t("skillLibraryLinks") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('bind-material')"
    >
      <AppIcon name="archive" :size="16" />
      <span>{{ t("materialLibraryLinks") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="emit('bindAgentTeams')"
    >
      <AppIcon name="brain" :size="16" />
      <span>{{ t("agentTeamLinks") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('export')"
    >
      <AppIcon name="download" :size="16" />
      <span>{{ t("export") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="activateLongBookAction('sync-legacy')"
    >
      <AppIcon name="history" :size="16" />
      <span>{{ t("syncLegacyVersion") }}</span>
    </button>
  </template>
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    :disabled="pending"
    :title="t('keepChangesOnDiskResolveFileConflictsAndRefresh')"
    @click.stop="activateLongBookAction('resolve-conflicts')"
  >
    <AppIcon name="history" :size="16" />
    <span>{{ t("resolveConflicts") }}</span>
  </button>
  <div class="tree-node-action-menu-divider" role="separator" />
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    @click.stop="activateLongBookAction('unregister')"
  >
    <AppIcon name="trash" :size="16" />
    <span>{{ t("removeKeepFiles") }}</span>
  </button>
  <button
    v-if="!unavailable"
    class="tree-node-action-menu-item is-danger"
    type="button"
    role="menuitem"
    @click.stop="activateLongBookAction('delete')"
  >
    <AppIcon name="trash" :size="16" />
    <span>{{ t("deleteLocalNovel") }}</span>
  </button>
</template>
<style scoped>
.tree-node-action-menu-item:disabled {
  cursor: default;
  opacity: 0.42;
}
</style>
