<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";
import AppIcon from "./AppIcon.vue";
import TreeNodeItem from "./TreeNodeItem.vue";

const props = defineProps<{
  section: ResourceTreeSection;
  selectedId: string;
}>();

const emit = defineEmits<{
  select: [node: ResourceTreeNode];
}>();

const collapsed = ref(false);
const actionMenuOpen = ref(false);
const actionArea = ref<HTMLElement | null>(null);

const actionItems = computed(() => {
  const resourceName =
    props.section.id === "creation"
      ? "书籍"
      : props.section.id === "skill"
        ? "技能库"
        : "素材库";
  return [
    { id: "create", label: `新建${resourceName}`, icon: "plus" as const },
    { id: "import", label: `导入已有${resourceName}`, icon: "folder" as const }
  ];
});

function handleDocumentPointerDown(event: PointerEvent): void {
  if (actionArea.value?.contains(event.target as Node)) {
    return;
  }
  actionMenuOpen.value = false;
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    actionMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
});
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
      <div ref="actionArea" class="section-action-area">
        <button
          class="section-action"
          :class="{ 'is-active': actionMenuOpen }"
          type="button"
          :aria-label="`${section.label}新建或导入`"
          :aria-expanded="actionMenuOpen"
          aria-haspopup="menu"
          @click="actionMenuOpen = !actionMenuOpen"
        >
          <AppIcon name="plus" :size="14" />
        </button>

        <div v-if="actionMenuOpen" class="section-action-menu" role="menu">
          <button
            v-for="item in actionItems"
            :key="item.id"
            class="section-action-menu-item"
            type="button"
            role="menuitem"
            :data-resource-action="`${section.id}-${item.id}`"
            @click="actionMenuOpen = false"
          >
            <AppIcon :name="item.icon" :size="17" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>

    <ul
      v-if="!collapsed"
      class="resource-tree"
      :aria-label="`${section.label}下的内容`"
    >
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
