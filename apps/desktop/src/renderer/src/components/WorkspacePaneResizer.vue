<script setup lang="ts">
import { t } from "../i18n";
import { RIGHT_PANE_MIN, useLayoutStore } from "../stores/layoutStore";

const layout = useLayoutStore();
</script>

<template>
  <div
    v-if="!layout.rightCollapsed"
    class="pane-resizer pane-resizer-right"
    role="separator"
    :aria-label="t('components.writingWorkspaceModule.resizeRightPane')"
    aria-orientation="vertical"
    :aria-valuemin="RIGHT_PANE_MIN"
    :aria-valuemax="layout.rightPaneMaxWidth"
    :aria-valuenow="layout.rightPaneWidth"
    tabindex="0"
    @pointerdown="layout.startPaneResize('right', $event)"
    @keydown="layout.handleResizeKeydown('right', $event)"
  />
</template>
