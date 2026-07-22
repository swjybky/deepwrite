<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../types/conversation";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  createEditorTextReference,
  resolveEditorTextReferenceRange
} from "../utils/editorTextReferences";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  document: WorkspaceDocument;
  resourceId: string;
  draftState: EditorDraftState | undefined;
  locateReference?: EditorTextReferenceNavigation | undefined;
  locked: boolean;
  lockedLabel?: string | undefined;
  saving?: boolean;
  boundToCurrentBook?: boolean;
  sectionTabs?: readonly { id: string; title: string }[];
  activeSectionId?: string | undefined;
}>();

const emit = defineEmits<{
  collapse: [];
  save: [payload: { id: string; title: string; content: string }];
  liveChange: [payload: { id: string; title: string; content: string }];
  insertSelection: [reference: EditorTextReference];
  selectSection: [sectionId: string];
  selectDraftFile: [fileKind: "body" | "character-state"];
}>();

const editorInput = ref<HTMLTextAreaElement>();
const selectionMenuElement = ref<HTMLElement>();
const selectionAction = ref<{
  reference: EditorTextReference;
  left: number;
  top: number;
} | null>(null);
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
    selectionAction.value = null;
  }
);

watch(
  () => [
    props.draftState?.title,
    props.draftState?.content,
    props.draftState?.dirty,
    props.document.title,
    props.document.content
  ] as const,
  ([nextTitle, nextContent, nextDirty, documentTitle, documentContent]) => {
    const resolvedTitle = nextTitle ?? documentTitle;
    const resolvedContent = nextContent ?? documentContent;
    if (title.value !== resolvedTitle) title.value = resolvedTitle;
    if (content.value !== resolvedContent) content.value = resolvedContent;
    dirty.value = nextDirty ?? false;
  }
);

const characterCount = computed(() => content.value.replace(/\s/g, "").length);
const paragraphs = computed(() => content.value.split(/\n{2,}/).filter(Boolean));
const showSectionTabs = computed(() => Boolean(props.sectionTabs?.length));
const showDraftFileTabs = computed(() => Boolean(props.document.draftFileKind));
const persistedDocument = computed(() =>
  Boolean(
    props.document.catalogDocumentId ||
      props.document.catalogEntryId ||
      props.document.catalogProjectRevision !== undefined
  )
);

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
  if (props.document.readOnly || props.locked || props.saving) {
    return;
  }
  emit("save", { id: props.document.id, title: title.value, content: content.value });
}

function closeSelectionAction(): void {
  selectionAction.value = null;
}

function captureEditorSelection(
  input: HTMLTextAreaElement,
  event?: MouseEvent
): boolean {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  const reference = createEditorTextReference({
    id: globalThis.crypto.randomUUID(),
    resourceId: props.resourceId,
    document: {
      ...props.document,
      title: title.value,
      content: content.value
    },
    start,
    end
  });
  if (!reference) {
    closeSelectionAction();
    return false;
  }

  const editorRect = input.getBoundingClientRect();
  const menuWidth = 142;
  const menuHeight = 42;
  const anchorLeft = event?.clientX ?? editorRect.left + 24;
  const anchorTop = event?.clientY ?? editorRect.top + 24;
  selectionAction.value = {
    reference,
    left: Math.max(8, Math.min(globalThis.innerWidth - menuWidth - 8, anchorLeft + 8)),
    top: Math.max(8, Math.min(globalThis.innerHeight - menuHeight - 8, anchorTop + 8))
  };
  return true;
}

function handleEditorContextMenu(event: MouseEvent): void {
  if (captureEditorSelection(event.currentTarget as HTMLTextAreaElement, event)) {
    event.preventDefault();
  }
}

function insertSelectedText(): void {
  const reference = selectionAction.value?.reference;
  if (!reference) return;
  emit("insertSelection", reference);
  closeSelectionAction();
}

function handleWindowPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Node && selectionMenuElement.value?.contains(target)) return;
  closeSelectionAction();
}

async function locateEditorReference(
  navigation: EditorTextReferenceNavigation | undefined
): Promise<void> {
  if (!navigation || navigation.reference.documentId !== props.document.id) return;
  viewMode.value = "edit";
  closeSelectionAction();
  await nextTick();
  const input = editorInput.value;
  if (!input) return;
  const range = resolveEditorTextReferenceRange(content.value, navigation.reference);
  input.focus();
  input.setSelectionRange(range.start, range.end, "forward");
  const line = content.value.slice(0, range.start).split("\n").length;
  const computedStyle = globalThis.getComputedStyle(input);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight);
  const resolvedLineHeight = Number.isFinite(lineHeight)
    ? lineHeight
    : Number.parseFloat(computedStyle.fontSize) * 1.95;
  input.scrollTop = Math.max(0, (line - 1) * resolvedLineHeight - input.clientHeight / 3);
}

watch(
  () => [props.locateReference?.requestId, props.document.id] as const,
  () => {
    void locateEditorReference(props.locateReference);
  },
  { flush: "post" }
);

onMounted(() => {
  globalThis.addEventListener("pointerdown", handleWindowPointerDown, true);
});

onBeforeUnmount(() => {
  globalThis.removeEventListener("pointerdown", handleWindowPointerDown, true);
});
</script>

<template>
  <aside
    class="editor-pane"
    :class="{ 'has-section-tabs': showSectionTabs }"
    aria-label="文本内容"
  >
    <header class="editor-header">
      <div class="editor-breadcrumbs" :title="document.path.join(' / ')">
        <span v-for="(part, index) in document.path" :key="`${part}-${index}`">
          {{ part }}<i v-if="index < document.path.length - 1">/</i>
        </span>
      </div>
      <div class="editor-header-actions">
        <span class="save-state" :class="{ 'is-dirty': dirty }">
          <AppIcon :name="dirty ? 'save' : 'check'" :size="13" />
          {{ document.readOnly ? "只读" : locked ? (lockedLabel ?? "智能体运行中 · 暂停编辑") : saving ? "正在保存到本机" : dirty ? "有未应用修改" : persistedDocument ? "已保存到本机" : "本次运行已应用" }}
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

    <nav
      v-if="showSectionTabs"
      class="section-tabs-bar"
      aria-label="正文小节"
    >
      <div class="section-tabs-scroll" role="tablist">
        <button
          v-for="section in sectionTabs ?? []"
          :key="section.id"
          class="section-tab"
          :class="{ 'is-active': section.id === activeSectionId }"
          type="button"
          role="tab"
          :aria-selected="section.id === activeSectionId"
          :title="section.title"
          @click="emit('selectSection', section.id)"
        >
          {{ section.title }}
        </button>
      </div>
    </nav>

    <div class="editor-toolbar">
      <div
        v-if="showDraftFileTabs"
        class="draft-file-tabs"
        role="tablist"
        aria-label="小节文件"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="document.draftFileKind === 'body'"
          :class="{ 'is-active': document.draftFileKind === 'body' }"
          @click="emit('selectDraftFile', 'body')"
        >
          正文
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="document.draftFileKind === 'character-state'"
          :class="{ 'is-active': document.draftFileKind === 'character-state' }"
          @click="emit('selectDraftFile', 'character-state')"
        >
          人物状态
        </button>
      </div>
      <span v-if="showDraftFileTabs" class="toolbar-separator" />
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
        <span v-if="document.domain !== 'creation'" class="readonly-badge">
          {{ boundToCurrentBook ? "已绑定到当前书籍" : "仅浏览 · 未绑定" }}
        </span>
      </div>

      <input
        v-model="title"
        class="document-title-input"
        :readonly="document.readOnly || locked || document.draftFileKind === 'character-state'"
        aria-label="文档标题"
        @input="markDirty"
      />

      <textarea
        v-if="viewMode === 'edit'"
        ref="editorInput"
        v-model="content"
        class="document-editor"
        :readonly="document.readOnly || locked"
        aria-label="文本内容编辑器"
        spellcheck="false"
        @input="markDirty"
        @contextmenu="handleEditorContextMenu"
        @scroll="closeSelectionAction"
      />
      <article v-else class="document-preview">
        <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
      </article>
    </div>

    <footer class="editor-footer">
      <span>{{ characterCount.toLocaleString("zh-CN") }} 字</span>
      <span>{{ locked ? (lockedLabel ?? "智能体运行中 · 防止版本冲突") : saving ? "正在原子保存本机文稿" : persistedDocument ? "本机文稿 · 应用后持久保存" : "内存草稿 · 重启后不保留" }}</span>
      <span class="footer-spacer" />
      <button
        class="save-button"
        type="button"
        :disabled="document.readOnly || locked || saving || !dirty"
        @click="save"
      >
        <AppIcon name="save" :size="14" />
        {{ saving ? "保存中…" : "应用" }}
      </button>
    </footer>
  </aside>

  <Teleport to="body">
    <div
      v-if="selectionAction"
      ref="selectionMenuElement"
      class="editor-selection-menu"
      role="menu"
      aria-label="正文选区操作"
      :style="{ left: `${selectionAction.left}px`, top: `${selectionAction.top}px` }"
    >
      <button
        type="button"
        role="menuitem"
        @mousedown.prevent
        @click="insertSelectedText"
      >
        <AppIcon name="message" :size="15" />
        插入输入框
      </button>
    </div>
  </Teleport>
</template>
