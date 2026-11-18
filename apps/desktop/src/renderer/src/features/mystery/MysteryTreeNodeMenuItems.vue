<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "../../components/AppIcon.vue";
import { createScopedTranslator } from "../../i18n";
import {
  mysteryWorkspaceNavigation,
  openMysteryWorkspaceDialog
} from "../../stores/mysteryWorkspaceNavigation";
import type { ResourceTreeNode } from "../../types/workspace";
import type { MysteryDialogState } from "./MysteryDialogs.vue";
import { mysteryT } from "./messages";

const props = defineProps<{ node: ResourceTreeNode }>();
const emit = defineEmits<{ close: []; bindAgentTeams: [] }>();
const treeT = createScopedTranslator("components.treeNodeItem");
const disabled = computed(() => {
  const port = mysteryWorkspaceNavigation.value;
  return !port || port.bookId() !== props.node.mysteryBookId || port.busy();
});

function open(dialog: MysteryDialogState): void {
  emit("close");
  if (props.node.mysteryBookId)
    openMysteryWorkspaceDialog(props.node.mysteryBookId, dialog);
}

async function move(): Promise<void> {
  const item = props.node.mysteryItem;
  const port = mysteryWorkspaceNavigation.value;
  if (!item || !port || disabled.value) return;
  emit("close");
  await port.moveItem({ kind: item.kind, id: item.id, move: "up" });
}
</script>

<template>
  <template v-if="node.catalogNodeType === 'mystery-book'">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled"
      @click.stop="open({ kind: 'boardSpec' })"
    >
      <AppIcon name="settings" :size="16" /><span>{{
        mysteryT("boardSpecButton")
      }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled"
      @click.stop="open({ kind: 'bindings' })"
    >
      <AppIcon name="library" :size="16" /><span>{{
        mysteryT("bindingsButton")
      }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled"
      @click.stop="emit('bindAgentTeams')"
    >
      <AppIcon name="brain" :size="16" /><span>{{
        treeT("agentTeamLinks")
      }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled"
      @click.stop="open({ kind: 'export' })"
    >
      <AppIcon name="download" :size="16" /><span>{{
        mysteryT("exportButton")
      }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled"
      @click.stop="open({ kind: 'manageBook' })"
    >
      <AppIcon name="more" :size="16" /><span>{{
        mysteryT("manageButton")
      }}</span>
    </button>
  </template>
  <template v-else-if="node.mysteryItem">
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled"
      @click.stop="
        open({
          kind: 'renameStructure',
          targetKind: node.mysteryItem.kind,
          id: node.mysteryItem.id,
          title: node.mysteryItem.title,
          tag: node.mysteryItem.tag
        })
      "
    >
      <AppIcon name="edit" :size="16" /><span>{{ mysteryT("rename") }}</span>
    </button>
    <button
      class="tree-node-action-menu-item"
      type="button"
      role="menuitem"
      :disabled="disabled || node.mysteryItem.moveUpDisabled"
      @click.stop="move"
    >
      <AppIcon name="arrow-up" :size="16" /><span>{{
        mysteryT("moveUp")
      }}</span>
    </button>
    <button
      class="tree-node-action-menu-item is-danger"
      type="button"
      role="menuitem"
      :disabled="disabled || node.mysteryItem.deleteDisabled"
      @click.stop="
        open({
          kind: 'deleteStructure',
          targetKind: node.mysteryItem.kind,
          id: node.mysteryItem.id,
          title: node.mysteryItem.title
        })
      "
    >
      <AppIcon name="trash" :size="16" /><span>{{ mysteryT("delete") }}</span>
    </button>
  </template>
</template>
