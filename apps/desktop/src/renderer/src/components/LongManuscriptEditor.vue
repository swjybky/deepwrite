<script setup lang="ts">
import { documentFormatLabel } from "./catalogLabels";
import { createScopedTranslator } from "../i18n";
import type { TextViewMode } from "@deepwrite/contracts";
import { onBeforeUnmount, ref, watch } from "vue";
import EditorSearchHighlight from "./EditorSearchHighlight.vue";
import MarkdownContent from "./MarkdownContent.vue";
import { editorCompositionValue } from "../composables/useEditorComposition";

const t = createScopedTranslator("components.longManuscriptEditor");

defineProps<{
  title: string;
  titleDraft: string;
  titleEditable: boolean;
  titleReadOnly: boolean;
  format: string;
  content: string;
  composing: boolean;
  viewMode: TextViewMode;
  readOnly: boolean;
  busy: boolean;
  searchMatches: readonly { start: number; end: number }[];
  activeSearchIndex: number;
  searchHighlightVisible: boolean;
}>();

const emit = defineEmits<{
  "update:titleDraft": [value: string];
  titleChange: [event: Event];
  titleKeydown: [event: KeyboardEvent];
  beforeinput: [event: InputEvent];
  input: [event: Event];
  compositionstart: [event: CompositionEvent];
  compositionend: [event: CompositionEvent];
  keydown: [event: KeyboardEvent];
  contextmenu: [event: MouseEvent];
  previewContextmenu: [event: MouseEvent];
  editorElementChange: [element: HTMLTextAreaElement | null];
  previewElementChange: [element: HTMLElement | null];
  editorScroll: [event: Event];
}>();

const editorElement = ref<HTMLTextAreaElement | null>(null);
const previewElement = ref<HTMLElement | null>(null);

watch(editorElement, (element) => emit("editorElementChange", element), {
  flush: "post"
});
watch(previewElement, (element) => emit("previewElementChange", element), {
  flush: "post"
});

onBeforeUnmount(() => {
  emit("editorElementChange", null);
  emit("previewElementChange", null);
});

function updateTitle(event: Event): void {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement) {
    emit("update:titleDraft", input.value);
  }
}
</script>

<template>
  <section
    class="long-manuscript-editor long-editor-writing-surface"
    :class="{ 'is-readonly': readOnly }"
    :aria-label="t('chapterManuscriptEditor')"
  >
    <input
      v-if="titleEditable"
      :value="titleDraft"
      class="long-document-title-input"
      :readonly="titleReadOnly"
      maxlength="256"
      autocomplete="off"
      :aria-label="t('chapterCardTitle')"
      @input="updateTitle"
      @change="emit('titleChange', $event)"
      @keydown="emit('titleKeydown', $event)"
    />
    <h1 v-else class="long-document-title">
      {{ title }}
    </h1>

    <EditorSearchHighlight
      v-if="viewMode === 'edit'"
      :content="content"
      :matches="searchMatches"
      :active-index="activeSearchIndex"
      :visible="searchHighlightVisible"
    >
      <textarea
        ref="editorElement"
        :value="editorCompositionValue(content, editorElement, composing)"
        class="long-document-editor"
        :readonly="readOnly || busy"
        :aria-label="
          t('documentLabel', {
            title: title,
            format: documentFormatLabel(format) || t('manuscript')
          })
        "
        spellcheck="false"
        @beforeinput="emit('beforeinput', $event)"
        @input="emit('input', $event)"
        @compositionstart="emit('compositionstart', $event)"
        @compositionend="emit('compositionend', $event)"
        @keydown="emit('keydown', $event)"
        @contextmenu="emit('contextmenu', $event)"
        @scroll="emit('editorScroll', $event)"
      />
    </EditorSearchHighlight>
    <article
      v-else
      ref="previewElement"
      class="long-document-preview"
      @contextmenu="emit('previewContextmenu', $event)"
      @scroll="emit('editorScroll', $event)"
    >
      <MarkdownContent
        v-if="content.trim()"
        :content="content"
        annotate-headings
      />
      <p v-else class="is-empty">
        {{ t("noManuscriptYet") }}
      </p>
    </article>
  </section>
</template>

<style scoped>
.long-editor-writing-surface {
  --long-document-inline-padding: clamp(18px, 2vw, 24px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  padding: 28px 0 18px;
  overflow: hidden;
  background: var(--surface-main);
}

.long-editor-writing-surface.is-readonly {
  background: var(--surface-raised);
}

.long-document-title-input,
.long-document-title {
  width: 100%;
  margin: 8px 0 13px;
  padding: 0 var(--long-document-inline-padding);
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--editor-font);
  font-size: clamp(1.71429rem, 2.2vw, 2.42857rem);
  font-weight: 600;
  line-height: 1.28;
  letter-spacing: -0.025em;
}

.long-document-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.long-document-title-input[readonly] {
  color: var(--text-primary);
}

.long-document-editor,
.long-document-preview {
  width: 100%;
  min-height: 0;
  padding: 0 var(--long-document-inline-padding) 80px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--editor-font);
  font-size: var(--editor-font-size, 15px);
  line-height: 1.95;
  letter-spacing: 0.025em;
}

.long-document-editor {
  resize: none;
  white-space: pre-wrap;
}

.long-document-title-input:focus-visible,
.long-document-editor:focus-visible {
  outline: 1px solid
    color-mix(in srgb, var(--theme-foreground) 22%, transparent);
}

:global(html[data-theme="dark"] .long-document-title-input:focus-visible),
:global(html[data-theme="dark"] .long-document-editor:focus-visible) {
  outline-color: rgb(255 255 255 / 22%);
}

.long-document-editor[readonly] {
  color: var(--text-secondary);
}

.long-document-preview :deep(.markdown-content) {
  white-space: normal;
}

.long-document-preview .is-empty {
  color: var(--text-tertiary);
}

@container (max-width: 40rem) {
  .long-editor-writing-surface {
    --long-document-inline-padding: clamp(14px, 4cqw, 20px);
    padding-top: 18px;
  }

  .long-document-title-input,
  .long-document-title {
    font-size: clamp(1.45rem, 7cqw, 2rem);
  }
}
</style>
