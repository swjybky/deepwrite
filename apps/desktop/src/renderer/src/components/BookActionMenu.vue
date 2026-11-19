<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { IconName, LongBookResourceNodeAction } from "../types/workspace";
import AppIcon from "./AppIcon.vue";

const t = createScopedTranslator("components.longBookActionMenu");
const treeT = createScopedTranslator("components.treeNodeItem");

defineProps<{
  unavailable?: boolean | undefined;
  pending?: boolean | undefined;
  pinned?: boolean | undefined;
}>();

const emit = defineEmits<{
  action: [action: LongBookResourceNodeAction];
  togglePin: [];
}>();

const actions = [
  ["manage-structure", "settings", "manage"],
  ["duplicate", "copy", "duplicate"],
  ["bind", "library", "bindings"],
  ["export", "download", "export"]
] as const satisfies ReadonlyArray<
  readonly [LongBookResourceNodeAction, IconName, string]
>;
</script>

<template>
  <template v-if="!unavailable">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      @click.stop="emit('togglePin')"
    >
      <AppIcon name="pin" :size="16" />
      <span>{{ pinned ? treeT("unpin") : treeT("pinned") }}</span>
    </button>
    <button
      v-for="[action, icon, label] in actions"
      :key="action"
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="pending"
      @click.stop="emit('action', action)"
    >
      <AppIcon :name="icon" :size="16" />
      <span>{{ t(label) }}</span>
    </button>
    <div class="tree-node-action-menu-divider" role="separator" />
  </template>
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    :disabled="pending && !unavailable"
    @click.stop="emit('action', 'unregister')"
  >
    <AppIcon name="trash" :size="16" />
    <span>{{ treeT("remove") }}</span>
  </button>
  <button
    v-if="!unavailable"
    class="tree-node-action-menu-item is-danger"
    type="button"
    role="menuitem"
    :disabled="pending"
    @click.stop="emit('action', 'delete')"
  >
    <AppIcon name="trash" :size="16" />
    <span>{{ treeT("delete") }}</span>
  </button>
</template>

<style scoped>
.tree-node-action-menu-item:disabled {
  cursor: default;
  opacity: 0.42;
}
</style>
