<script setup lang="ts">
import { ref } from "vue";
import type { ResourceTreeNode } from "../types/workspace";
import AppIcon from "./AppIcon.vue";

defineOptions({ name: "TreeNodeItem" });

const props = defineProps<{
  node: ResourceTreeNode;
  depth: number;
  selectedId: string;
}>();

const emit = defineEmits<{
  select: [node: ResourceTreeNode];
}>();

const open = ref(props.node.defaultExpanded ?? false);

function activate(): void {
  if (props.node.children?.length) {
    open.value = !open.value;
    return;
  }
  emit("select", props.node);
}

</script>

<template>
  <li class="tree-node">
    <button
      class="tree-row"
      :class="{ 'is-selected': selectedId === node.id, 'is-muted': node.muted }"
      :style="{ '--tree-depth': depth }"
      type="button"
      :title="node.label"
      :data-resource-id="node.id"
      :aria-expanded="node.children?.length ? open : undefined"
      :aria-label="node.children?.length ? `${open ? '折叠' : '展开'}${node.label}` : node.label"
      @click="activate"
    >
      <span
        v-if="node.children?.length"
        class="tree-chevron"
        :class="{ 'is-open': open }"
      >
        <AppIcon name="chevron" :size="13" />
      </span>
      <span v-else class="tree-chevron-spacer" />

      <AppIcon :name="node.icon ?? (node.children?.length ? 'folder' : 'file')" :size="15" />
      <span class="tree-label">{{ node.label }}</span>
      <span v-if="node.badge" class="tree-badge">{{ node.badge }}</span>
    </button>

    <ul v-if="node.children?.length && open" class="tree-children">
      <TreeNodeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>
