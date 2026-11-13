<script setup lang="ts">
import { computed, ref } from "vue";
import { createScopedTranslator } from "../i18n";
import {
  handleMarkdownImageLoad,
  useMarkdownImageFallback
} from "../composables/useMarkdownImageFallback";
import { useEditableMarkdownPreview } from "../composables/useEditableMarkdownPreview";
import { renderMarkdown } from "../utils/renderMarkdown";
import type { MarkdownSourceEdit } from "../utils/bookImageInsertion";
import "./markdown-images.css";
import "./rich-markdown-preview.css";

const t = createScopedTranslator("components.bookImages");
const handleMarkdownImageError = useMarkdownImageFallback();
const props = withDefaults(
  defineProps<{
    content: string;
    editable: boolean;
    documentKey?: string | undefined;
    resolveImage?: ((path: string) => string | undefined) | undefined;
    annotateHeadings?: boolean;
    maxLength?: number | undefined;
    emptyText?: string | undefined;
  }>(),
  { annotateHeadings: false, documentKey: "" }
);
const emit = defineEmits<{
  edit: [edit: MarkdownSourceEdit];
  compositionChange: [composing: boolean];
  undo: [];
  redo: [];
  keydown: [event: KeyboardEvent];
}>();
const root = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
const { ready } = useEditableMarkdownPreview(props, emit, root, host, () =>
  t("source")
);
const fallback = computed(() =>
  renderMarkdown(props.content, {
    resolveImage: props.resolveImage,
    annotateHeadings: props.annotateHeadings
  })
);
</script>
<template>
  <div
    ref="root"
    class="markdown-content editable-markdown-preview"
    :class="{ 'is-editable': editable, 'is-empty': !content }"
    :data-empty-text="editable || !emptyText ? t('empty') : emptyText"
    @error.capture="handleMarkdownImageError"
    @load.capture="handleMarkdownImageLoad"
  >
    <!-- The fallback is shown only while the editor kernel loads, never on click. -->
    <div v-if="!ready" v-html="fallback" />
    <div ref="host" v-show="ready" class="editable-markdown-rendered" />
  </div>
</template>
