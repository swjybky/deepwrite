<script setup lang="ts">
import { deepwriteApi } from "../api/deepwrite";
import { createScopedTranslator } from "../i18n";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef
} from "vue";
import type { WindowFrameAction, WindowFrameState } from "@deepwrite/contracts";
import {
  windowFrameMenusKey,
  type WorkspaceWindowActions
} from "../composables/windowFrameMenus";
import { uiMessage } from "../ui-feedback";
import { WindowMenuBar } from "./lazyAppComponents";

const t = createScopedTranslator("components.windowFrame");
const api = deepwriteApi()?.windowFrame;
const state = ref<WindowFrameState>({
  customTitlebar: false,
  maximized: false,
  fullscreen: false
});
const actions = shallowRef<WorkspaceWindowActions | null>(null);
provide(windowFrameMenusKey, actions);
const menuBar = ref<InstanceType<typeof WindowMenuBar> | null>(null);
const initialMenu = ref<number | null>(null);
const openInitially = ref(true);
const enabled = computed(() => state.value.customTitlebar);
function activateMenu(index: number, open = true) {
  if (!actions.value) return;
  if (menuBar.value) void menuBar.value.activate(index, open);
  else {
    openInitially.value = open;
    initialMenu.value = index;
  }
}
async function command(action: WindowFrameAction) {
  try {
    if (api) state.value = await api.command(action);
  } catch {
    uiMessage.error(t("windowActionFailedTryAgain"));
  }
}
function keydown(event: KeyboardEvent) {
  if (
    !enabled.value ||
    event.defaultPrevented ||
    document.querySelector('[aria-modal="true"]')
  )
    return;
  if (event.key === "F11") {
    event.preventDefault();
    void command("toggleFullscreen");
  }
  if (
    event.key === "F10" ||
    (event.altKey && event.key.toLowerCase() === "f")
  ) {
    event.preventDefault();
    activateMenu(0, event.altKey);
  }
}
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  if (api) {
    unsubscribe = api.subscribe((value) => {
      state.value = value;
    });
    void command("state");
  }
  window.addEventListener("keydown", keydown);
});
onBeforeUnmount(() => {
  unsubscribe?.();
  window.removeEventListener("keydown", keydown);
});
</script>

<template>
  <div class="window-frame" :class="{ 'has-titlebar': enabled }">
    <header v-if="enabled" class="window-titlebar">
      <WindowMenuBar
        v-if="initialMenu !== null && actions"
        ref="menuBar"
        :actions="actions"
        :fullscreen="state.fullscreen"
        :initial-menu="initialMenu"
        :open-initially="openInitially"
        @command="command"
      />
      <nav
        v-else
        role="menubar"
        :aria-label="t('applicationMenu')"
        class="window-menus"
      >
        <button
          v-for="(label, index) in [t('file'), t('view'), t('help')]"
          :key="label"
          type="button"
          class="window-menu-launcher"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded="false"
          :aria-label="label + t('menu')"
          :disabled="!actions"
          @pointerdown.prevent="activateMenu(index)"
          @click="activateMenu(index)"
          @keydown.down.prevent="activateMenu(index)"
          @keydown.up.prevent="activateMenu(index)"
          @focus="activateMenu(index, false)"
        >
          {{ label }}
        </button>
      </nav>
      <span class="window-title">DeepWrite</span>
      <div class="window-controls">
        <button
          v-for="(label, action) in {
            minimize: t('minimizeWindow'),
            toggleMaximize: state.maximized
              ? t('restoreWindow')
              : t('maximizeWindow'),
            close: t('closeWindow')
          }"
          :key="action"
          type="button"
          :title="label"
          :aria-label="label"
          :data-action="action"
          :class="{ 'is-maximized': state.maximized }"
          :disabled="action === 'toggleMaximize' && state.fullscreen"
          @click="command(action)"
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </header>
    <main class="window-content"><slot /></main>
  </div>
</template>

<style src="../styles/window-frame.css"></style>
