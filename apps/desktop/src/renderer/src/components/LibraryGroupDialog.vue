<script lang="ts">
export const CREATE_DEFAULT_LIBRARY_VALUE = "__create_default_library__";
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  CreateLibraryGroupInput,
  MaterialKind,
  MaterialLibrary,
  MaterialLibraryGroup,
  SkillKind,
  SkillLibrary,
  SkillLibraryGroup,
  UpdateLibraryGroupInput
} from "@deepwrite/contracts";
import { MATERIAL_KINDS, SKILL_KINDS } from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import PopupSelect from "./PopupSelect.vue";

const CREATE_DEFAULT_LIBRARY_VALUE = "__create_default_library__";

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
const resolving = ref(false);
const editing = computed(() => Boolean(props.group));
const domainLabel = computed(() => (props.domain === "material" ? "素材" : "技能"));
const busy = computed(() => Boolean(props.submitting) || resolving.value);
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
  if (!libraryId || libraryId === CREATE_DEFAULT_LIBRARY_VALUE) return false;
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
          {
            value: CREATE_DEFAULT_LIBRARY_VALUE,
            label: "＋ 新建默认库",
            description: `创建新的${MATERIAL_LABELS[kind]}并绑定到此分组`
          },
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
          {
            value: CREATE_DEFAULT_LIBRARY_VALUE,
            label: "＋ 新建默认库",
            description: `创建新的${SKILL_LABELS[kind]}并绑定到此分组`
          },
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
  if (!busy.value) emit("close");
}

function defaultLibraryName(kind: string): string {
  const kindLabel =
    props.domain === "material"
      ? MATERIAL_LABELS[kind as MaterialKind]
      : SKILL_LABELS[kind as SkillKind];
  const groupTitle = editing.value
    ? props.group?.title.trim() || "分组"
    : title.value.trim() || "分组";
  return `${groupTitle} · ${kindLabel}`;
}

async function resolveMemberSelections(
  kinds: readonly string[]
): Promise<Record<string, string> | null> {
  const api = window.deepwrite;
  if (!api) {
    uiMessage.error("桌面桥接尚未就绪，请稍后重试。");
    return null;
  }
  const resolved: Record<string, string> = {};
  for (const kind of kinds) {
    const selected = selections.value[kind];
    if (!selected) continue;
    if (selected !== CREATE_DEFAULT_LIBRARY_VALUE) {
      resolved[kind] = selected;
      continue;
    }
    const created =
      props.domain === "material"
        ? await api.catalog.createLibrary({
            domain: "material",
            name: defaultLibraryName(kind),
            materialKind: kind as MaterialKind
          })
        : await api.catalog.createLibrary({
            domain: "skill",
            name: defaultLibraryName(kind),
            skillKind: kind as SkillKind
          });
    if (!created) {
      uiMessage.info("已取消新建默认库，分组操作未继续。");
      return null;
    }
    resolved[kind] = created.id;
    selections.value[kind] = created.id;
  }
  return resolved;
}

async function submit(): Promise<void> {
  if (busy.value) return;
  const name = title.value.trim();
  if (!editing.value && !name) {
    uiMessage.warning("请输入分组名称");
    titleInput.value?.focus();
    return;
  }

  resolving.value = true;
  try {
    if (props.domain === "material") {
      const members = await resolveMemberSelections(MATERIAL_KINDS);
      if (!members) return;
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
      const members = await resolveMemberSelections(SKILL_KINDS);
      if (!members) return;
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
  } catch (error: unknown) {
    uiMessage.error(error instanceof Error ? error.message : "新建默认库失败。");
  } finally {
    resolving.value = false;
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
      ? (Object.fromEntries(
          Object.entries(props.group.members).filter(([, libraryId]) => Boolean(libraryId))
        ) as Record<string, string>)
      : {};
    resolving.value = false;
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
            :disabled="busy"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form class="dialog-content catalog-resource-form" @submit.prevent="submit">
          <p class="dialog-description">
            <template v-if="editing">
              调整“{{ group?.title }}”包含的{{ domainLabel }}库。移出的库会回到原分类，新绑定的库会移动到此分组。已有库被占用时，也可选择「新建默认库」。
            </template>
            <template v-else>
              每一种类型最多选择一个已有{{ domainLabel }}库，也可以选择「新建默认库」当场创建，或全部留空稍后再补充。
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
              :disabled="busy"
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
                :disabled="busy"
                :menu-min-width="250"
                @update:model-value="selections[row.kind] = String($event)"
              />
            </label>
          </fieldset>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="busy"
              @click="requestClose"
            >
              取消
            </button>
            <button class="dialog-primary-button" type="submit" :disabled="busy">
              {{
                resolving
                  ? "创建默认库…"
                  : submitting
                    ? editing
                      ? "保存中…"
                      : "创建中…"
                    : editing
                      ? "保存绑定"
                      : "创建分组"
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
