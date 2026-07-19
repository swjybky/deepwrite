<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  CreateLibraryEntryInput,
  MaterialLibraryKind,
  MaterialStageId,
  SkillStageId
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

type LibraryDomain = "material" | "skill";
type LibraryDialogOperation =
  | "create-library"
  | "create-entry"
  | "remove-entry";
type CreateLibraryEntryDraft =
  | Omit<Extract<CreateLibraryEntryInput, { domain: "material" }>, "content">
  | Omit<Extract<CreateLibraryEntryInput, { domain: "skill" }>, "content">;

const props = defineProps<{
  open: boolean;
  operation: LibraryDialogOperation | null;
  domain: LibraryDomain;
  libraryId?: string | undefined;
  libraryTitle?: string | undefined;
  materialKind?: MaterialLibraryKind | undefined;
  entryId?: string | undefined;
  entryTitle?: string | undefined;
  submitting?: boolean | undefined;
}>();

const emit = defineEmits<{
  close: [];
  createLibrary: [payload: { domain: LibraryDomain; name: string }];
  createEntry: [payload: CreateLibraryEntryDraft];
  removeEntry: [payload: {
    domain: LibraryDomain;
    libraryId: string;
    entryId: string;
  }];
}>();

const title = ref("");
const stageId = ref<MaterialStageId | SkillStageId>("other");
const titleInput = ref<HTMLInputElement | null>(null);
const domainLabel = computed(() => (props.domain === "material" ? "素材" : "技能"));
const heading = computed(() => {
  if (props.operation === "create-library") return `新建${domainLabel.value}库`;
  if (props.operation === "create-entry") return `在“${props.libraryTitle ?? "资料库"}”中新建条目`;
  return `删除“${props.entryTitle ?? "条目"}”`;
});
const stageOptions = computed(() => {
  if (props.domain === "material") {
    const allOptions = [
        { value: "gimmick", label: "梗" },
        { value: "character", label: "人设" },
        { value: "pacing", label: "剧情设计" },
        { value: "intro", label: "导语设计" },
        { value: "plot_refine", label: "剧情细化" },
        { value: "draft_excerpt", label: "优秀正文片段" },
        { value: "other", label: "其他素材" }
      ];
    const allowedByKind: Record<MaterialLibraryKind, readonly string[]> = {
      character: ["character"],
      gimmick: ["gimmick"],
      plot: ["pacing", "intro", "plot_refine"],
      draft: ["draft_excerpt"],
      other: ["other"],
      mixed: allOptions.map(({ value }) => value)
    };
    const allowed = new Set(
      allowedByKind[props.materialKind ?? "mixed"]
    );
    return allOptions.filter(({ value }) => allowed.has(value));
  }
  return [
    { value: "character_design", label: "人物设计" },
    { value: "plot_design", label: "剧情设计" },
    { value: "outline", label: "大纲" },
    { value: "draft", label: "正文" },
    { value: "expert_section_writer", label: "分节写手" }
  ];
});

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  if (props.operation === "remove-entry") {
    if (!props.libraryId || !props.entryId) {
      uiMessage.error("未找到要删除的条目");
      return;
    }
    emit("removeEntry", {
      domain: props.domain,
      libraryId: props.libraryId,
      entryId: props.entryId
    });
    return;
  }

  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) {
    uiMessage.warning(props.operation === "create-library" ? "请输入资料库名称" : "请输入条目名称");
    titleInput.value?.focus();
    return;
  }
  if (props.operation === "create-library") {
    emit("createLibrary", { domain: props.domain, name: normalizedTitle });
    return;
  }
  if (!props.libraryId) {
    uiMessage.error("未找到要新增内容的资料库");
    return;
  }
  if (props.domain === "material") {
    emit("createEntry", {
      domain: "material",
      libraryId: props.libraryId,
      title: normalizedTitle,
      stageId: stageId.value as MaterialStageId
    });
  } else {
    emit("createEntry", {
      domain: "skill",
      libraryId: props.libraryId,
      title: normalizedTitle,
      stageId: stageId.value as SkillStageId
    });
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

watch(
  () =>
    [
      props.open,
      props.operation,
      props.domain,
      props.libraryId,
      props.materialKind
    ] as const,
  ([open]) => {
    if (!open) return;
    title.value = "";
    stageId.value =
      (stageOptions.value[0]?.value as MaterialStageId | SkillStageId | undefined) ??
      (props.domain === "material" ? "other" : "draft");
    if (props.operation !== "remove-entry") {
      void nextTick(() => titleInput.value?.focus());
    }
  },
  { immediate: true }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog library-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-project-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ domainLabel }}库 · 本地文件夹项目</span>
            <h2 id="library-project-dialog-title">{{ heading }}</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            aria-label="关闭"
            :disabled="submitting"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form class="dialog-content catalog-resource-form" @submit.prevent="submit">
          <template v-if="operation === 'create-library'">
            <p class="dialog-description">
              下一步会选择保存位置，并创建一个可由 Finder、Git 或文本编辑器直接管理的文件夹。
            </p>
            <label class="book-resource-name-field">
              <span>{{ domainLabel }}库名称</span>
              <input
                ref="titleInput"
                v-model="title"
                type="text"
                maxlength="80"
                autocomplete="off"
                :placeholder="`请输入${domainLabel}库名称`"
                :disabled="submitting"
              />
            </label>
            <p class="book-resource-help">
              文件夹中会保存 deepwrite.json，正文条目位于 entries/*.md。
            </p>
          </template>

          <template v-else-if="operation === 'create-entry'">
            <p class="dialog-description">
              新条目会立即创建为 entries 目录中的 Markdown 文件，之后可在编辑器或外部工具中继续编写。
            </p>
            <label class="book-resource-name-field">
              <span>条目名称</span>
              <input
                ref="titleInput"
                v-model="title"
                type="text"
                maxlength="80"
                autocomplete="off"
                placeholder="请输入条目名称"
                :disabled="submitting"
              />
            </label>
            <label class="book-resource-name-field catalog-resource-stage-field">
              <span>内容阶段</span>
              <PopupSelect
                :model-value="stageId"
                :options="stageOptions"
                accessible-label="内容阶段"
                size="large"
                :disabled="submitting"
                :menu-min-width="220"
                @update:model-value="stageId = String($event) as MaterialStageId | SkillStageId"
              />
            </label>
          </template>

          <div v-else class="catalog-resource-warning">
            <AppIcon name="trash" :size="20" />
            <div>
              <strong>这会删除对应的 Markdown 文件</strong>
              <p>“{{ entryTitle }}”将从“{{ libraryTitle }}”及磁盘中删除，未保存修改也会丢失；此操作不能通过重新打开资料库恢复。</p>
            </div>
          </div>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              取消
            </button>
            <button
              class="dialog-primary-button"
              :class="{ 'is-danger': operation === 'remove-entry' }"
              type="submit"
              :disabled="submitting"
            >
              {{
                submitting
                  ? "处理中…"
                  : operation === "create-library"
                    ? "选择位置并创建"
                    : operation === "create-entry"
                      ? "创建条目"
                      : "确认删除"
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
