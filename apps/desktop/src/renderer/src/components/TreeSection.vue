<script setup lang="ts">
import { ref } from "vue";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import TreeNodeItem from "./TreeNodeItem.vue";

defineProps<{
  section: ResourceTreeSection;
  selectedId: string;
}>();

const emit = defineEmits<{
  select: [node: ResourceTreeNode];
}>();

const collapsed = ref(false);
</script>

<template>
  <section class="resource-section" :class="{ 'is-collapsed': collapsed }">
    <div class="resource-section-heading">
      <button
        class="section-toggle"
        type="button"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? `展开${section.label}` : `折叠${section.label}`"
        @click="collapsed = !collapsed"
      >
        <AppIcon name="chevron" :size="13" />
        <AppIcon :name="section.icon" :size="15" />
        <span>{{ section.label }}</span>
      </button>
      <button class="section-action" type="button" :aria-label="`新建${section.label}内容`">
        <AppIcon name="plus" :size="14" />
      </button>
    </div>

    <ul v-if="!collapsed" class="resource-tree" :aria-label="section.label">
      <TreeNodeItem
        v-for="node in section.nodes"
        :key="node.id"
        :node="node"
        :depth="0"
        :selected-id="selectedId"
        @select="emit('select', $event)"
      />
    </ul>
  </section>
</template>
