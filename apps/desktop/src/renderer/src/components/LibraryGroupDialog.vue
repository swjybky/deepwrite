<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  CreateLibraryGroupInput,
  MaterialLibrary,
  MaterialLibraryGroup,
  SkillLibrary,
  SkillLibraryGroup,
  UpdateLibraryGroupInput
} from "@deepwrite/contracts";
import { MATERIAL_KINDS, SKILL_KINDS } from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import PopupSelect from "./PopupSelect.vue";

type LibraryDomain = "material" | "skill";

const props = defineProps<{
  open: boolean;
  domain: LibraryDomain;
  materials: readonly MaterialLibrary[];
  materialGroups: readonly MaterialLibraryGroup[];
  skills: readonly SkillLibrary[];
  skillGroups: readonly SkillLibraryGroup[];
  group?: MaterialLibraryGroup | SkillLibraryGroup | null;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [payload: CreateLibraryGroupInput | UpdateLibraryGroupInput];
}>();

const MATERIAL_LABELS = {
  character: "人设素材库",
  gimmick: "梗素材库",
  plot: "剧情素材库",
  draft: "正文素材库",
  other: "其他素材库"
} as const;
const SKILL_LABELS = {
  general: "通用技能库",
  plot: "剧情设计技能库",
  style: "文风写作技能库",
  other: "其他技能库"
} as const;

const title = ref("");
const titleInput = ref<HTMLInputElement | null>(null);
const selections = ref<Record<string, string>>({});
const editing = computed(() => Boolean(props.group));
const domainLabel = computed(() => (props.domain === "material" ? "素材" : "技能"));
const unavailableLibraryIds = computed(() => {
  const groups = props.domain === "material" ? props.materialGroups : props.skillGroups;
  return new Set(
    groups
      .filter((group) => group.id !== props.group?.id)
      .flatMap((group) => Object.values(group.members))
      .filter((libraryId): libraryId is string => Boolean(libraryId))
  );
});
function selectedInAnotherRow(kind: string, libraryId: string): boolean {
  return Object.entries(selections.value).some(
    ([selectedKind, selectedLibraryId]) =>
      selectedKind !== kind && selectedLibraryId === libraryId
  );
}
const rows = computed(() =>
  props.domain === "material"
    ? MATERIAL_KINDS.map((kind) => ({
        kind,
        label: MATERIAL_LABELS[kind],
        options: [
          { value: "", label: "不选择" },
          ...props.materials
            .filter(
              (library) =>
                library.materialType === "short" &&
                (library.materialKind === kind || library.materialKind === "mixed") &&
                !unavailableLibraryIds.value.has(library.id) &&
                !selectedInAnotherRow(kind, library.id)
            )
            .map((library) => ({ value: library.id, label: library.title }))
        ]
      }))
    : SKILL_KINDS.map((kind) => ({
        kind,
        label: SKILL_LABELS[kind],
        options: [
          { value: "", label: "不选择" },
          ...props.skills
            .filter(
              (library) =>
                library.skillType === "short" &&
                library.skillKind === kind &&
                !unavailableLibraryIds.value.has(library.id) &&
                !selectedInAnotherRow(kind, library.id)
            )
            .map((library) => ({ value: library.id, label: library.title }))
        ]
      }))
);

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  const name = title.value.trim();
  if (!editing.value && !name) {
    uiMessage.warning("请输入分组名称");
    titleInput.value?.focus();
    return;
  }
  if (props.domain === "material") {
    const members = Object.fromEntries(
      MATERIAL_KINDS.flatMap((kind) =>
        selections.value[kind] ? [[kind, selections.value[kind]]] : []
      )
    );
    emit(
      "submit",
      props.group
        ? {
            domain: "material",
            groupId: props.group.id,
            members,
            ...(props.group.projectRevision === undefined
              ? {}
              : { baseProjectRevision: props.group.projectRevision })
          }
        : { domain: "material", name, members }
    );
  } else {
    const members = Object.fromEntries(
      SKILL_KINDS.flatMap((kind) =>
        selections.value[kind] ? [[kind, selections.value[kind]]] : []
      )
    );
    emit(
      "submit",
      props.group
        ? {
            domain: "skill",
            groupId: props.group.id,
            members,
            ...(props.group.projectRevision === undefined
              ? {}
              : { baseProjectRevision: props.group.projectRevision })
          }
        : { domain: "skill", name, members }
    );
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

watch(
  () => [props.open, props.domain, props.group] as const,
  ([open]) => {
    if (!open) return;
    title.value = props.group?.title ?? "";
    selections.value = props.group
      ? Object.fromEntries(
          Object.entries(props.group.members).filter(([, libraryId]) => Boolean(libraryId))
        ) as Record<string, string>
      : {};
    if (!props.group) {
      void nextTick(() => titleInput.value?.focus());
    }
  }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog library-project-dialog library-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-group-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ domainLabel }}库分组</span>
            <h2 id="library-group-dialog-title">{{ editing ? "切换绑定" : "新建分组" }}</h2>
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
          <p class="dialog-description">
            <template v-if="editing">
              调整“{{ group?.title }}”包含的{{ domainLabel }}库。移出的库会回到原分类，新绑定的库会移动到此分组。
            </template>
            <template v-else>
              每一种类型最多选择一个已有{{ domainLabel }}库，也可以全部留空，稍后再补充。
            </template>
          </p>
          <label v-if="!editing" class="book-resource-name-field">
            <span>分组名称</span>
            <input
              ref="titleInput"
              v-model="title"
              type="text"
              maxlength="80"
              autocomplete="off"
              placeholder="请输入分组名称"
              :disabled="submitting"
            />
          </label>

          <fieldset class="library-group-members">
            <legend>选择{{ domainLabel }}库</legend>
            <label v-for="row in rows" :key="row.kind" class="library-group-member-row">
              <span>{{ row.label }}</span>
              <PopupSelect
                :model-value="selections[row.kind] ?? ''"
                :options="row.options"
                :accessible-label="row.label"
                size="large"
                :disabled="submitting"
                :menu-min-width="250"
                @update:model-value="selections[row.kind] = String($event)"
              />
            </label>
          </fieldset>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              取消
            </button>
            <button class="dialog-primary-button" type="submit" :disabled="submitting">
              {{ submitting ? (editing ? "保存中…" : "创建中…") : (editing ? "保存绑定" : "创建分组") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
