<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  document: WorkspaceDocument;
  draftState: EditorDraftState | undefined;
  locked: boolean;
}>();

const emit = defineEmits<{
  collapse: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
}>();

const title = ref(props.draftState?.title ?? props.document.title);
const content = ref(props.draftState?.content ?? props.document.content);
const dirty = ref(props.draftState?.dirty ?? false);
const viewMode = ref<"edit" | "preview">("edit");

watch(
  () => props.document.id,
  () => {
    title.value = props.draftState?.title ?? props.document.title;
    content.value = props.draftState?.content ?? props.document.content;
    dirty.value = props.draftState?.dirty ?? false;
    viewMode.value = "edit";
  }
);

watch(
  () => [props.draftState?.title, props.draftState?.content, props.draftState?.dirty] as const,
  ([nextTitle, nextContent, nextDirty]) => {
    const resolvedTitle = nextTitle ?? props.document.title;
    const resolvedContent = nextContent ?? props.document.content;
    if (title.value !== resolvedTitle) title.value = resolvedTitle;
    if (content.value !== resolvedContent) content.value = resolvedContent;
    dirty.value = nextDirty ?? false;
  }
);

const characterCount = computed(() => content.value.replace(/\s/g, "").length);
const paragraphs = computed(() => content.value.split(/\n{2,}/).filter(Boolean));

function markDirty(): void {
  if (props.document.readOnly || props.locked) return;
  dirty.value = true;
  emit("liveChange", {
    id: props.document.id,
    title: title.value,
    content: content.value
  });
}

function save(): void {
  if (props.document.readOnly || props.locked) {
    return;
  }
  emit("save", { id: props.document.id, title: title.value, content: content.value });
  dirty.value = false;
}
</script>

<template>
  <aside class="editor-pane" aria-label="文本内容">
    <header class="editor-header">
      <div class="editor-breadcrumbs" :title="document.path.join(' / ')">
        <span v-for="(part, index) in document.path" :key="`${part}-${index}`">
          {{ part }}<i v-if="index < document.path.length - 1">/</i>
        </span>
      </div>
      <div class="editor-header-actions">
        <span class="save-state" :class="{ 'is-dirty': dirty }">
          <AppIcon :name="dirty ? 'save' : 'check'" :size="13" />
          {{ document.readOnly ? "只读" : locked ? "智能体运行中 · 暂停编辑" : dirty ? "有未应用修改" : "本次运行已应用" }}
        </span>
        <button
          class="icon-button"
          type="button"
          aria-label="收起文本内容栏"
          @click="emit('collapse')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <div class="editor-toolbar">
      <div class="view-tabs" role="tablist" aria-label="文本视图">
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'edit'"
          :class="{ 'is-active': viewMode === 'edit' }"
          @click="viewMode = 'edit'"
        >
          编辑
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'preview'"
          :class="{ 'is-active': viewMode === 'preview' }"
          @click="viewMode = 'preview'"
        >
          预览
        </button>
      </div>
      <span class="toolbar-separator" />
      <button class="format-button" type="button" aria-label="粗体"><AppIcon name="bold" :size="15" /></button>
      <button class="format-button" type="button" aria-label="斜体"><AppIcon name="italic" :size="15" /></button>
      <button class="format-button" type="button" aria-label="引用"><AppIcon name="quote" :size="15" /></button>
      <span class="toolbar-spacer" />
      <button class="format-button" type="button" aria-label="更多格式"><AppIcon name="more" :size="16" /></button>
    </div>

    <div class="editor-document" :class="{ 'is-readonly': document.readOnly || locked }">
      <div class="document-meta-row">
        <span>{{ document.eyebrow }}</span>
        <span v-if="document.format" class="document-format">{{ document.format }}</span>
        <span v-if="document.readOnly" class="readonly-badge">只读内容</span>
        <span v-if="document.domain !== 'creation'" class="readonly-badge">仅浏览 · 未附加</span>
      </div>

      <input
        v-model="title"
        class="document-title-input"
        :readonly="document.readOnly || locked"
        aria-label="文档标题"
        @input="markDirty"
      />

      <textarea
        v-if="viewMode === 'edit'"
        v-model="content"
        class="document-editor"
        :readonly="document.readOnly || locked"
        aria-label="文本内容编辑器"
        spellcheck="false"
        @input="markDirty"
      />
      <article v-else class="document-preview">
        <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
      </article>
    </div>

    <footer class="editor-footer">
      <span>{{ characterCount.toLocaleString("zh-CN") }} 字</span>
      <span>{{ locked ? "智能体运行中 · 防止版本冲突" : "内存草稿 · 重启后不保留" }}</span>
      <span class="footer-spacer" />
      <button
        class="save-button"
        type="button"
        :disabled="document.readOnly || locked || !dirty"
        @click="save"
      >
        <AppIcon name="save" :size="14" />
        应用
      </button>
    </footer>
  </aside>
</template>
