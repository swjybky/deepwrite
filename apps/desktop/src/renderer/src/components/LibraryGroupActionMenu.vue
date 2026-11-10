<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { CatalogResourceNodeAction } from "../types/workspace";
import AppIcon from "./AppIcon.vue";

defineProps<{ unavailable?: boolean }>();
defineEmits<{ action: [action: CatalogResourceNodeAction] }>();

const t = createScopedTranslator("components.treeNodeItem");
</script>

<template>
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    @click.stop="$emit('action', 'edit-group-bindings')"
  >
    <AppIcon name="edit" :size="16" />
    <span>{{ t("editGroup") }}</span>
  </button>
  <button
    v-if="!unavailable"
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    @click.stop="$emit('action', 'duplicate-group')"
  >
    <AppIcon name="copy" :size="16" />
    <span>{{ t("duplicate") }}</span>
  </button>
  <button
    v-if="!unavailable"
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    @click.stop="$emit('action', 'export-group')"
  >
    <AppIcon name="download" :size="16" />
    <span>{{ t("export") }}</span>
  </button>
  <button
    class="tree-node-action-menu-item"
    type="button"
    role="menuitem"
    @click.stop="$emit('action', 'dissolve-group')"
  >
    <AppIcon name="trash" :size="16" />
    <span>{{ t("ungroup") }}</span>
  </button>
  <button
    v-if="!unavailable"
    class="tree-node-action-menu-item is-danger"
    type="button"
    role="menuitem"
    @click.stop="$emit('action', 'delete-group')"
  >
    <AppIcon name="trash" :size="16" />
    <span>{{ t("deleteGroup") }}</span>
  </button>
</template>
