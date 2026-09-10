<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { TextViewMode } from "@deepwrite/contracts/renderer";
import type { WorkspaceDocument } from "../types/workspace";
import { parseSkillFrontmatter } from "../utils/skillFrontmatter";
import DocumentMetaRow from "./DocumentMetaRow.vue";

const MaterialMetadataEditor = defineAsyncComponent(
  () => import("./MaterialMetadataEditor.vue")
);
const SkillMetadataEditor = defineAsyncComponent(
  () => import("./SkillMetadataEditor.vue")
);

const props = defineProps<{
  document: WorkspaceDocument;
  title: string;
  content: string;
  viewMode: TextViewMode;
  previewElement: HTMLElement | null;
  documentKey: string;
  boundToCurrentBook?: boolean;
  locked: boolean;
}>();
const emit = defineEmits<{ change: [content: string] }>();
const skillFormatError = computed(() => {
  if (props.document.domain !== "skill" || !props.document.catalogEntryId)
    return undefined;
  const result = parseSkillFrontmatter(props.content);
  return result.valid ? undefined : result.message;
});
</script>

<template>
  <DocumentMetaRow
    :view-mode="viewMode"
    :content="content"
    :preview-element="previewElement"
    :document-key="documentKey"
  >
    <span>{{ document.eyebrow }}</span>
    <span v-if="document.format" class="document-format">{{
      document.format
    }}</span>
    <span v-if="document.readOnly" class="readonly-badge">只读内容</span>
    <span v-if="document.domain !== 'creation'" class="readonly-badge">{{
      boundToCurrentBook ? "已绑定到当前书籍" : "仅浏览 · 未绑定"
    }}</span>
    <span
      v-if="skillFormatError"
      class="skill-format-error-badge"
      role="status"
      :title="skillFormatError"
      :aria-label="skillFormatError"
      >{{ skillFormatError }}</span
    >
    <template #actions>
      <MaterialMetadataEditor
        v-if="document.domain === 'material' && document.catalogEntryId"
        :entry-id="document.catalogEntryId"
        :title="title"
        :content="content"
        :read-only="document.readOnly || locked"
        @change="emit('change', $event)"
      />
      <SkillMetadataEditor
        v-else-if="document.domain === 'skill' && document.catalogEntryId"
        :entry-id="document.catalogEntryId"
        :title="title"
        :content="content"
        :read-only="document.readOnly || locked"
        @change="emit('change', $event)"
      />
    </template>
  </DocumentMetaRow>
</template>
