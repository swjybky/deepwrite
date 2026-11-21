<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type { WorkspacePaneLayout } from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import LongWorkspacePanePlaceholder from "./LongWorkspacePanePlaceholder.vue";

const t = createScopedTranslator("components.longWorkspaceLoading");

// Vue forwards the async component's complete props/listeners to its fallback.
// Ignore the data-loading prop: the component chunk may still be pending
// after the workspace data has arrived. Only an explicit pending override is used.
defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    paneLayout: WorkspacePaneLayout;
    pending?: boolean;
  }>(),
  { pending: true }
);
const emit = defineEmits<{ expandLeft: [] }>();
</script>

<template>
  <button
    v-if="leftCollapsed"
    class="icon-button long-workspace-expand-sidebar"
    type="button"
    :aria-label="t('expandSidebar')"
    @click="emit('expandLeft')"
  >
    <AppIcon name="panel-left" :size="18" />
  </button>
  <div
    v-show="paneLayout === 'agent-editor' || !rightCollapsed"
    class="long-agent-column"
    :aria-label="t('novelWorkspace')"
  >
    <LongWorkspacePanePlaceholder kind="agent" :loading="pending" />
  </div>
  <LongWorkspacePanePlaceholder
    v-if="paneLayout === 'editor-agent' || !rightCollapsed"
    kind="editor"
    :right-pane="paneLayout === 'agent-editor'"
    :loading="pending"
  />
</template>
