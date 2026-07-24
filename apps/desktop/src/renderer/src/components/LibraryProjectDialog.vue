<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  CreateLibraryInput,
  CreateLibraryEntryInput,
  MaterialKind,
  MaterialLibraryKind,
  MaterialStageId,
  SkillKind
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
  createLibrary: [payload: CreateLibraryInput];
  createEntry: [payload: CreateLibraryEntryDraft];
  removeEntry: [payload: {
    domain: LibraryDomain;
    libraryId: string;
    entryId: string;
  }];
}>();

const title = ref("");
const stageId = ref<MaterialStageId>("other");
const libraryKind = ref<MaterialKind | SkillKind>("character");
const titleInput = ref<HTMLInputElement | null>(null);
const domainLabel = computed(() => (props.domain === "material" ? "素材" : "技能"));
const heading = computed(() => {
  if (props.operation === "create-library") return `新建${domainLabel.value}库`;
  if (props.operation === "create-entry") return `在“${props.libraryTitle ?? "资料库"}”中新建条目`;
  return `删除“${props.entryTitle ?? "条目"}”`;
});
const libraryKindOptions = computed(() =>
  props.domain === "material"
    ? [
        { value: "character", label: "人设素材库" },
        { value: "gimmick", label: "梗素材库" },
        { value: "plot", label: "剧情素材库" },
        { value: "draft", label: "正文素材库" },
        { value: "other", label: "其他素材库" }
      ]
    : [
        { value: "general", label: "通用技能库" },
        { value: "plot", label: "剧情设计技能库" },
        { value: "style", label: "文风写作技能库" },
        { value: "other", label: "其他技能库" }
      ]
);
const stageOptions = computed(() => {
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
  const allowed = new Set(allowedByKind[props.materialKind ?? "mixed"]);
  return allOptions.filter(({ value }) => allowed.has(value));
});
const showEntryStageField = computed(
  () => props.operation === "create-entry" && props.domain === "material"
);

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
    if (props.domain === "material") {
      emit("createLibrary", {
        domain: "material",
        name: normalizedTitle,
        materialKind: libraryKind.value as MaterialKind
      });
    } else {
      emit("createLibrary", {
        domain: "skill",
        name: normalizedTitle,
        skillKind: libraryKind.value as SkillKind
      });
    }
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
      stageId: stageId.value
    });
  } else {
    emit("createEntry", {
      domain: "skill",
      libraryId: props.libraryId,
      title: normalizedTitle
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
    libraryKind.value = props.domain === "material" ? "character" : "general";
    stageId.value =
      (stageOptions.value[0]?.value as MaterialStageId | undefined) ?? "other";
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
              新资料库会自动保存在当前工作目录中，无需再次选择目录。
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
            <label class="book-resource-name-field catalog-resource-stage-field">
              <span>{{ domainLabel }}库分类</span>
              <PopupSelect
                :model-value="libraryKind"
                :options="libraryKindOptions"
                :accessible-label="`${domainLabel}库分类`"
                size="large"
                :disabled="submitting"
                :menu-min-width="220"
                @update:model-value="libraryKind = String($event) as MaterialKind | SkillKind"
              />
            </label>
            <p class="book-resource-help">
              文件夹中会保存 deepwrite.json，正文条目位于 entries/*.md；可由 Finder、Git 或文本编辑器直接管理。
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
            <label
              v-if="showEntryStageField"
              class="book-resource-name-field catalog-resource-stage-field"
            >
              <span>内容阶段</span>
              <PopupSelect
                :model-value="stageId"
                :options="stageOptions"
                accessible-label="内容阶段"
                size="large"
                :disabled="submitting"
                :menu-min-width="220"
                @update:model-value="stageId = String($event) as MaterialStageId"
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
                    ? `创建${domainLabel}库`
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
