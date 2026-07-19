<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { SHORT_BOOK_GENRES } from "@deepwrite/contracts";
import type {
  CreateShortBookInput,
  MaterialKind,
  MaterialLibrary,
  MaterialLibraryGroup,
  ShortBookGenre,
  SkillKind,
  SkillLibrary,
  SkillLibraryGroup
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    materials?: readonly MaterialLibrary[];
    materialGroups?: readonly MaterialLibraryGroup[];
    skills?: readonly SkillLibrary[];
    skillGroups?: readonly SkillLibraryGroup[];
    loading?: boolean;
    submitting?: boolean;
  }>(),
  {
    materials: () => [],
    materialGroups: () => [],
    skills: () => [],
    skillGroups: () => [],
    loading: false,
    submitting: false
  }
);

const emit = defineEmits<{
  close: [];
  submit: [payload: CreateShortBookInput];
}>();

const MATERIAL_KINDS: ReadonlyArray<{
  id: MaterialKind;
  label: string;
  description: string;
}> = [
  { id: "character", label: "人设素材库", description: "人物与关系设定" },
  { id: "gimmick", label: "梗素材库", description: "核心创意与钩子" },
  { id: "plot", label: "剧情素材库", description: "剧情、导语与细化" },
  { id: "draft", label: "正文素材库", description: "正文片段与表达参考" },
  { id: "other", label: "其他素材库", description: "未归入以上分类的素材" }
];
const SKILL_KINDS: ReadonlyArray<{
  id: SkillKind;
  label: string;
  description: string;
}> = [
  { id: "general", label: "通用技能库", description: "多个阶段均可使用" },
  { id: "plot", label: "剧情设计技能库", description: "人物、剧情与大纲方法" },
  { id: "style", label: "文风写作技能库", description: "正文与分节写作方法" },
  { id: "other", label: "其他技能库", description: "自定义写作方法" }
];

const title = ref("");
const genre = ref<ShortBookGenre>("世情");
const materialBindingMode = ref<"single" | "group">("single");
const skillBindingMode = ref<"single" | "group">("single");
const selectedMaterialGroupId = ref("");
const selectedSkillGroupId = ref("");
const selectedMaterialIds = reactive<Record<MaterialKind, string>>({
  character: "",
  gimmick: "",
  plot: "",
  draft: "",
  other: ""
});
const selectedSkillIds = reactive<Record<SkillKind, string>>({
  general: "",
  plot: "",
  style: "",
  other: ""
});
const titleInput = ref<HTMLInputElement | null>(null);

const shortMaterials = computed(() =>
  props.materials.filter((material) => material.materialType === "short")
);
const shortSkills = computed(() =>
  props.skills.filter((skill) => skill.skillType === "short")
);
const materialById = computed(
  () => new Map(shortMaterials.value.map((material) => [material.id, material] as const))
);
const skillById = computed(
  () => new Map(shortSkills.value.map((skill) => [skill.id, skill] as const))
);

function materialCandidates(kind: MaterialKind): MaterialLibrary[] {
  return shortMaterials.value.filter(
    (material) => material.materialKind === kind || material.materialKind === "mixed"
  );
}

function skillCandidates(kind: SkillKind): SkillLibrary[] {
  return shortSkills.value.filter((skill) => skill.skillKind === kind);
}

function emptyMaterialLinks(): Record<MaterialKind, string[]> {
  return {
    character: [],
    gimmick: [],
    plot: [],
    draft: [],
    other: []
  };
}

function emptySkillLinks(): Record<SkillKind, string[]> {
  return {
    general: [],
    plot: [],
    style: [],
    other: []
  };
}

function materialGroupLinks(
  group: MaterialLibraryGroup | undefined
): Record<MaterialKind, string[]> {
  const links = emptyMaterialLinks();
  if (!group) return links;
  for (const { id: kind } of MATERIAL_KINDS) {
    const libraryId = group.members[kind];
    const library = libraryId ? materialById.value.get(libraryId) : undefined;
    if (library && (library.materialKind === kind || library.materialKind === "mixed")) {
      links[kind] = [library.id];
    }
  }
  return links;
}

function skillGroupLinks(
  group: SkillLibraryGroup | undefined
): Record<SkillKind, string[]> {
  const links = emptySkillLinks();
  if (!group) return links;
  for (const { id: kind } of SKILL_KINDS) {
    const libraryId = group.members[kind];
    const library = libraryId ? skillById.value.get(libraryId) : undefined;
    if (library?.skillKind === kind) {
      links[kind] = [library.id];
    }
  }
  return links;
}

const availableMaterialGroups = computed(() =>
  props.materialGroups.filter((group) =>
    MATERIAL_KINDS.some(({ id }) => materialGroupLinks(group)[id].length > 0)
  )
);
const availableSkillGroups = computed(() =>
  props.skillGroups.filter((group) =>
    SKILL_KINDS.some(({ id }) => skillGroupLinks(group)[id].length > 0)
  )
);
const selectedMaterialGroup = computed(() =>
  availableMaterialGroups.value.find((group) => group.id === selectedMaterialGroupId.value)
);
const selectedSkillGroup = computed(() =>
  availableSkillGroups.value.find((group) => group.id === selectedSkillGroupId.value)
);

function materialLibraryLabel(library: MaterialLibrary): string {
  const genreLabel = [library.parentGenre, library.subGenre]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" / ");
  return genreLabel ? `${library.title} · ${genreLabel}` : library.title;
}

function skillLibraryLabel(library: SkillLibrary): string {
  return library.isBuiltin ? `${library.title} · 官方` : library.title;
}

function materialSelectOptions(kind: MaterialKind): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "不关联" },
    ...materialCandidates(kind).map((library) => ({
      value: library.id,
      label: materialLibraryLabel(library)
    }))
  ];
}

function skillSelectOptions(kind: SkillKind): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "不绑定" },
    ...skillCandidates(kind).map((library) => ({
      value: library.id,
      label: skillLibraryLabel(library)
    }))
  ];
}

const materialGroupOptions = computed(() => [
  { value: "", label: "不关联" },
  ...availableMaterialGroups.value.map((group) => ({ value: group.id, label: group.title }))
]);
const skillGroupOptions = computed(() => [
  { value: "", label: "不绑定" },
  ...availableSkillGroups.value.map((group) => ({ value: group.id, label: group.title }))
]);

function selectedMaterialLinks(): Record<MaterialKind, string[]> {
  if (materialBindingMode.value === "group") {
    return materialGroupLinks(selectedMaterialGroup.value);
  }
  return Object.fromEntries(
    MATERIAL_KINDS.map(({ id }) => {
      const selectedId = selectedMaterialIds[id];
      const valid = selectedId && materialCandidates(id).some((library) => library.id === selectedId);
      return [id, valid ? [selectedId] : []];
    })
  ) as Record<MaterialKind, string[]>;
}

function selectedSkillLinks(): Record<SkillKind, string[]> {
  if (skillBindingMode.value === "group") {
    return skillGroupLinks(selectedSkillGroup.value);
  }
  return Object.fromEntries(
    SKILL_KINDS.map(({ id }) => {
      const selectedId = selectedSkillIds[id];
      const valid = selectedId && skillCandidates(id).some((library) => library.id === selectedId);
      return [id, valid ? [selectedId] : []];
    })
  ) as Record<SkillKind, string[]>;
}

function resetDraft(): void {
  title.value = "";
  genre.value = "世情";
  materialBindingMode.value = "single";
  skillBindingMode.value = "single";
  selectedMaterialGroupId.value = "";
  selectedSkillGroupId.value = "";
  for (const { id } of MATERIAL_KINDS) selectedMaterialIds[id] = "";
  for (const { id } of SKILL_KINDS) selectedSkillIds[id] = "";
}

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) {
    uiMessage.warning("请输入书名");
    titleInput.value?.focus();
    return;
  }
  emit("submit", {
    title: normalizedTitle,
    genre: genre.value,
    linkedMaterialIdsByKind: selectedMaterialLinks(),
    linkedSkillIdsByKind: selectedSkillLinks()
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    resetDraft();
    void nextTick(() => titleInput.value?.focus());
  },
  { immediate: true }
);

watch(availableMaterialGroups, (groups) => {
  if (selectedMaterialGroupId.value && !groups.some((group) => group.id === selectedMaterialGroupId.value)) {
    selectedMaterialGroupId.value = "";
  }
});

watch(availableSkillGroups, (groups) => {
  if (selectedSkillGroupId.value && !groups.some((group) => group.id === selectedSkillGroupId.value)) {
    selectedSkillGroupId.value = "";
  }
});

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog create-short-book-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-short-book-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">创作空间 · 短篇</span>
            <h2 id="create-short-book-title">新建短篇书籍</h2>
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

        <form class="dialog-content create-short-book-form" @submit.prevent="submit">
          <section class="create-short-book-basics" aria-labelledby="create-short-basics-heading">
            <h3 id="create-short-basics-heading">书籍信息</h3>
            <label class="create-short-book-field">
              <span>书名</span>
              <input
                ref="titleInput"
                v-model="title"
                type="text"
                maxlength="80"
                autocomplete="off"
                placeholder="请输入书名"
                :disabled="submitting"
              />
            </label>

            <fieldset class="create-short-genre-field">
              <legend>短篇分类</legend>
              <div class="create-short-genre-options">
                <label
                  v-for="option in SHORT_BOOK_GENRES"
                  :key="option"
                  class="create-short-genre-option"
                  :class="{ 'is-selected': genre === option }"
                >
                  <input
                    v-model="genre"
                    type="radio"
                    name="shortBookGenre"
                    :value="option"
                    :disabled="submitting"
                  />
                  <span>{{ option }}</span>
                </label>
              </div>
            </fieldset>
          </section>

          <section class="create-short-binding-panel" aria-labelledby="create-short-material-heading">
            <div class="create-short-binding-heading">
              <span class="create-short-binding-icon"><AppIcon name="archive" :size="17" /></span>
              <div>
                <h3 id="create-short-material-heading">关联素材库</h3>
                <p>按用途选择素材库；未选择的分类可在创作空间中稍后补充。</p>
              </div>
            </div>

            <div class="create-short-binding-modes" role="radiogroup" aria-label="素材库关联方式">
              <label :class="{ 'is-selected': materialBindingMode === 'single' }">
                <input
                  v-model="materialBindingMode"
                  type="radio"
                  value="single"
                  :disabled="submitting"
                />
                按分类选择
              </label>
              <label
                :class="{ 'is-selected': materialBindingMode === 'group' }"
                :title="availableMaterialGroups.length ? '' : '暂无可用素材分组'"
              >
                <input
                  v-model="materialBindingMode"
                  type="radio"
                  value="group"
                  :disabled="submitting || availableMaterialGroups.length === 0"
                />
                选择分组
              </label>
            </div>

            <div v-if="materialBindingMode === 'single'" class="create-short-kind-grid">
              <label v-for="kind in MATERIAL_KINDS" :key="kind.id" class="create-short-kind-field">
                <span>
                  <strong>{{ kind.label }}</strong>
                  <small>{{ kind.description }}</small>
                </span>
                <PopupSelect
                  :model-value="selectedMaterialIds[kind.id]"
                  :options="materialSelectOptions(kind.id)"
                  :accessible-label="kind.label"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="selectedMaterialIds[kind.id] = String($event)"
                />
              </label>
            </div>
            <div v-else class="create-short-group-picker">
              <label class="create-short-book-field">
                <span>素材分组</span>
                <PopupSelect
                  :model-value="selectedMaterialGroupId"
                  :options="materialGroupOptions"
                  accessible-label="素材分组"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="selectedMaterialGroupId = String($event)"
                />
              </label>
              <div v-if="selectedMaterialGroup" class="create-short-group-members">
                <span v-for="kind in MATERIAL_KINDS" :key="kind.id">
                  <small>{{ kind.label }}</small>
                  <strong>
                    {{ materialById.get(selectedMaterialGroup.members[kind.id] ?? "")?.title ?? "未配置" }}
                  </strong>
                </span>
              </div>
              <p v-else class="create-short-stable-hint">选择分组后，会一次关联其中已配置的各类素材库。</p>
            </div>
          </section>

          <section class="create-short-binding-panel" aria-labelledby="create-short-skill-heading">
            <div class="create-short-binding-heading">
              <span class="create-short-binding-icon"><AppIcon name="library" :size="17" /></span>
              <div>
                <h3 id="create-short-skill-heading">绑定技能库</h3>
                <p>智能体只会按当前阶段和读取范围加载已绑定技能。</p>
              </div>
            </div>

            <div class="create-short-binding-modes" role="radiogroup" aria-label="技能库绑定方式">
              <label :class="{ 'is-selected': skillBindingMode === 'single' }">
                <input
                  v-model="skillBindingMode"
                  type="radio"
                  value="single"
                  :disabled="submitting"
                />
                按分类选择
              </label>
              <label
                :class="{ 'is-selected': skillBindingMode === 'group' }"
                :title="availableSkillGroups.length ? '' : '暂无可用技能分组'"
              >
                <input
                  v-model="skillBindingMode"
                  type="radio"
                  value="group"
                  :disabled="submitting || availableSkillGroups.length === 0"
                />
                选择分组
              </label>
            </div>

            <div v-if="skillBindingMode === 'single'" class="create-short-kind-grid">
              <label v-for="kind in SKILL_KINDS" :key="kind.id" class="create-short-kind-field">
                <span>
                  <strong>{{ kind.label }}</strong>
                  <small>{{ kind.description }}</small>
                </span>
                <PopupSelect
                  :model-value="selectedSkillIds[kind.id]"
                  :options="skillSelectOptions(kind.id)"
                  :accessible-label="kind.label"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="selectedSkillIds[kind.id] = String($event)"
                />
              </label>
            </div>
            <div v-else class="create-short-group-picker">
              <label class="create-short-book-field">
                <span>技能分组</span>
                <PopupSelect
                  :model-value="selectedSkillGroupId"
                  :options="skillGroupOptions"
                  accessible-label="技能分组"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="selectedSkillGroupId = String($event)"
                />
              </label>
              <div v-if="selectedSkillGroup" class="create-short-group-members">
                <span v-for="kind in SKILL_KINDS" :key="kind.id">
                  <small>{{ kind.label }}</small>
                  <strong>
                    {{ skillById.get(selectedSkillGroup.members[kind.id] ?? "")?.title ?? "未配置" }}
                  </strong>
                </span>
              </div>
              <p v-else class="create-short-stable-hint">选择分组后，会一次绑定其中已配置的各类技能库。</p>
            </div>
          </section>

          <p v-if="loading" class="create-short-stable-hint">正在加载素材库和技能库目录…</p>

          <div class="dialog-actions create-short-book-actions">
            <button class="dialog-secondary-button" type="button" :disabled="submitting" @click="requestClose">
              取消
            </button>
            <button class="dialog-primary-button" type="submit" :disabled="loading || submitting">
              {{ submitting ? "创建中…" : "创建书籍" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
