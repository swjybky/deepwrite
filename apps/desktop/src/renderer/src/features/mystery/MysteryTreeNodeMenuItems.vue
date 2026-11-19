<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import { createScopedTranslator } from "../../i18n";
import {
  mysteryWorkspaceNavigation,
  openMysteryWorkspaceDialog
} from "../../stores/mysteryWorkspaceNavigation";
import type { ResourceTreeNode } from "../../types/workspace";

const props = defineProps<{ node: ResourceTreeNode }>();
const emit = defineEmits<{
  close: [];
}>();
const t = createScopedTranslator("components.treeNodeItem");
const disabled = computed(() => {
  if (props.node.unavailable) return false;
  const port = mysteryWorkspaceNavigation.value;
  return !port || port.bookId() !== props.node.mysteryBookId || port.busy();
});

function open(kind: "renameStructure" | "deleteStructure"): void {
  const { mysteryBookId, mysteryItem: item } = props.node;
  if (!mysteryBookId || !item) return;
  emit("close");
  openMysteryWorkspaceDialog(mysteryBookId, {
    kind,
    targetKind: item.kind,
    id: item.id,
    title: item.title,
    tag: item.tag
  });
}

function move(direction: "up" | "down"): void {
  const item = props.node.mysteryItem;
  if (!item || disabled.value) return;
  emit("close");
  void mysteryWorkspaceNavigation.value?.moveItem({
    kind: item.kind,
    id: item.id,
    move: direction
  });
}
</script>

<template>
  <template v-if="node.mysteryItem">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled"
      @click.stop="open('renameStructure')"
    >
      <AppIcon name="edit" :size="16" /><span>{{ t("rename") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled || node.mysteryItem.moveUpDisabled"
      @click.stop="move('up')"
    >
      <span>↑</span><span>{{ t("moveUp") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled || node.mysteryItem.moveDownDisabled"
      @click.stop="move('down')"
    >
      <span>↓</span><span>{{ t("moveDown") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item is-danger"
      type="button"
      role="menuitem"
      :disabled="disabled || node.mysteryItem.deleteDisabled"
      @click.stop="open('deleteStructure')"
    >
      <AppIcon name="trash" :size="16" /><span>{{ t("delete") }}</span>
    </button>
  </template>
</template>
