<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { buildEditorSearchHighlightSegments } from "../utils/editorSearchHighlight";

const props = defineProps<{
  content: string;
  matches: readonly { start: number; end: number }[];
  activeIndex: number;
  visible: boolean;
}>();

const rootElement = ref<HTMLElement | null>(null);
const overlayStyle = ref<Record<string, string>>({});
const contentStyle = ref<Record<string, string>>({});
const segments = computed(() =>
  props.visible
    ? buildEditorSearchHighlightSegments(
        props.content,
        props.matches,
        props.activeIndex
      )
    : []
);

let editor: HTMLTextAreaElement | null = null;
let resizeObserver: ResizeObserver | null = null;

function syncOverlay(): void {
  if (!editor) return;
  const style = globalThis.getComputedStyle(editor);
  overlayStyle.value = {
    top: `${editor.offsetTop + editor.clientTop}px`,
    left: `${editor.offsetLeft + editor.clientLeft}px`,
    width: `${editor.clientWidth}px`,
    height: `${editor.clientHeight}px`
  };
  contentStyle.value = {
    width: `${editor.scrollWidth}px`,
    minHeight: `${editor.scrollHeight}px`,
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textIndent: style.textIndent,
    textTransform: style.textTransform,
    tabSize: style.tabSize,
    whiteSpace: style.whiteSpace,
    wordBreak: style.wordBreak,
    overflowWrap: style.overflowWrap,
    transform: `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`
  };
}

function bindEditor(): void {
  const nextEditor =
    rootElement.value?.querySelector<HTMLTextAreaElement>("textarea") ?? null;
  if (nextEditor === editor) {
    syncOverlay();
    return;
  }

  editor?.removeEventListener("scroll", syncOverlay);
  resizeObserver?.disconnect();
  editor = nextEditor;
  if (!editor) return;
  editor.addEventListener("scroll", syncOverlay, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(syncOverlay);
    resizeObserver.observe(editor);
  }
  syncOverlay();
}

onMounted(() => void nextTick(bindEditor));
watch(
  () => [props.content, props.visible] as const,
  () => void nextTick(bindEditor),
  { flush: "post" }
);
onBeforeUnmount(() => {
  editor?.removeEventListener("scroll", syncOverlay);
  resizeObserver?.disconnect();
});
</script>

<template>
  <div ref="rootElement" class="editor-search-highlight-surface">
    <div
      v-if="segments.length"
      class="editor-search-highlight-overlay"
      :style="overlayStyle"
      aria-hidden="true"
    >
      <div class="editor-search-highlight-content" :style="contentStyle">
        <template v-for="(segment, index) in segments" :key="index">
          <mark
            v-if="segment.match"
            class="editor-search-highlight-mark"
            :class="{ 'is-active': segment.active }"
            >{{ segment.text }}</mark
          >
          <template v-else>{{ segment.text }}</template>
        </template>
      </div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.editor-search-highlight-surface {
  position: relative;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.editor-search-highlight-surface :deep(textarea) {
  position: relative;
  z-index: 1;
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: transparent;
}

.editor-search-highlight-overlay {
  position: absolute;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.editor-search-highlight-content {
  box-sizing: border-box;
  color: transparent;
  transform-origin: top left;
}

.editor-search-highlight-mark {
  padding: 0;
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent) 24%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 34%, transparent);
  color: transparent;
}

.editor-search-highlight-mark.is-active {
  background: color-mix(in srgb, var(--accent) 52%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 72%, transparent);
}
</style>
