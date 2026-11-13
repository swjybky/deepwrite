<script setup lang="ts">
import { computed } from "vue";
import "./markdown-images.css";
import {
  handleMarkdownImageLoad,
  useMarkdownImageFallback
} from "../composables/useMarkdownImageFallback";
import { renderMarkdown } from "../utils/renderMarkdown";

const props = withDefaults(
  defineProps<{
    content: string;
    annotateHeadings?: boolean;
    resolveImage?: ((path: string) => string | undefined) | undefined;
  }>(),
  { annotateHeadings: false }
);
const handleMarkdownImageError = useMarkdownImageFallback();
const html = computed(() =>
  renderMarkdown(props.content, {
    annotateHeadings: props.annotateHeadings,
    resolveImage: props.resolveImage
  })
);
</script>

<template>
  <!-- renderMarkdown escapes source text before adding its allowlisted HTML subset. -->
  <div
    class="markdown-content"
    @error.capture="handleMarkdownImageError"
    @load.capture="handleMarkdownImageLoad"
    v-html="html"
  />
</template>
