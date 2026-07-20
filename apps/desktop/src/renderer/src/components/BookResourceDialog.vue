<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialKind,
  MaterialLibraryGroup,
  SkillKind,
  SkillLibraryGroup
} from "@deepwrite/contracts";
import type {
  BookResourceDialogMode,
  ResourceTreeNode
} from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

const props = withDefaults(defineProps<{
  mode: BookResourceDialogMode | null;
  book: ResourceTreeNode | null;
  skillLibraries: ResourceTreeNode[];
  materialLibraries: ResourceTreeNode[];
  materialGroups?: readonly MaterialLibraryGroup[];
  skillGroups?: readonly SkillLibraryGroup[];
  loading?: boolean;
  submitting?: boolean;
}>(), {
  materialGroups: () => [],
  skillGroups: () => [],
  loading: false,
  submitting: false
});

type BindingPayload =
  | { bookId: string; domain: "skill"; linksByKind: LinkedSkillIdsByKind }
  | { bookId: string; domain: "material"; linksByKind: LinkedMaterialIdsByKind };

const emit = defineEmits<{
  close: [];
  rename: [payload: { bookId: string; label: string }];
  remove: [bookId: string];
  updateBindings: [payload: BindingPayload];
}>();

const MATERIAL_KINDS: ReadonlyArray<{ id: MaterialKind; label: string; description: string }> = [
  { id: "character", label: "人设素材库", description: "人物与关系设定" },
  { id: "gimmick", label: "梗素材库", description: "核心创意与钩子" },
  { id: "plot", label: "剧情素材库", description: "剧情、导语与细化" },
  { id: "draft", label: "正文素材库", description: "正文片段与表达参考" },
  { id: "other", label: "其他素材库", description: "未归入以上分类的素材" }
];
const SKILL_KINDS: ReadonlyArray<{ id: SkillKind; label: string; description: string }> = [
  { id: "general", label: "通用技能库", description: "多个阶段均可使用" },
  { id: "plot", label: "剧情设计技能库", description: "人物、剧情与大纲方法" },
  { id: "style", label: "文风写作技能库", description: "正文与分节写作方法" },
  { id: "other", label: "其他技能库", description: "自定义写作方法" }
];

const nameDraft = ref("");
const bindingMode = ref<"single" | "group">("single");
const selectedGroupId = ref("");
const selectedMaterialIds = reactive<Record<MaterialKind, string>>({
  character: "", gimmick: "", plot: "", draft: "", other: ""
});
const selectedSkillIds = reactive<Record<SkillKind, string>>({
  general: "", plot: "", style: "", other: ""
});
const nameInput = ref<HTMLInputElement | null>(null);

const bindingDomain = computed<"skill" | "material" | null>(() => {
  if (props.mode === "bind-skill") return "skill";
  if (props.mode === "bind-material") return "material";
  return null;
});
const title = computed(() => {
  if (props.mode === "rename") return "修改书籍名称";
  if (props.mode === "remove") return "移除书籍";
  if (props.mode === "bind-skill") return "技能库绑定";
  return "素材库绑定";
});

function materialCandidates(kind: MaterialKind): ResourceTreeNode[] {
  return props.materialLibraries.filter(
    (library) => library.materialKind === kind || library.materialKind === "mixed"
  );
}

function skillCandidates(kind: SkillKind): ResourceTreeNode[] {
  return props.skillLibraries.filter((library) => library.skillKind === kind);
}

function materialGroupLinks(group: MaterialLibraryGroup | undefined): LinkedMaterialIdsByKind {
  const links: LinkedMaterialIdsByKind = { character: [], gimmick: [], plot: [], draft: [], other: [] };
  if (!group) return links;
  for (const { id: kind } of MATERIAL_KINDS) {
    const libraryId = group.members[kind];
    if (libraryId && materialCandidates(kind).some((library) => library.id === libraryId)) {
      links[kind] = [libraryId];
    }
  }
  return links;
}

function skillGroupLinks(group: SkillLibraryGroup | undefined): LinkedSkillIdsByKind {
  const links: LinkedSkillIdsByKind = { general: [], plot: [], style: [], other: [] };
  if (!group) return links;
  for (const { id: kind } of SKILL_KINDS) {
    const libraryId = group.members[kind];
    if (libraryId && skillCandidates(kind).some((library) => library.id === libraryId)) {
      links[kind] = [libraryId];
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
const availableGroups = computed(() =>
  bindingDomain.value === "skill" ? availableSkillGroups.value : availableMaterialGroups.value
);
const selectedMaterialGroup = computed(() =>
  availableMaterialGroups.value.find((group) => group.id === selectedGroupId.value)
);
const selectedSkillGroup = computed(() =>
  availableSkillGroups.value.find((group) => group.id === selectedGroupId.value)
);
const groupOptions = computed(() => [
  { value: "", label: bindingDomain.value === "skill" ? "不绑定" : "不关联" },
  ...availableGroups.value.map((group) => ({ value: group.id, label: group.title }))
]);

function materialOptions(kind: MaterialKind): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "不关联" },
    ...materialCandidates(kind).map((library) => ({
      value: library.id,
      label: library.badge ? `${library.label} · ${library.badge}` : library.label
    }))
  ];
}

function skillOptions(kind: SkillKind): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "不绑定" },
    ...skillCandidates(kind).map((library) => ({
      value: library.id,
      label: library.badge ? `${library.label} · ${library.badge}` : library.label
    }))
  ];
}

function resetBindingDraft(): void {
  bindingMode.value = "single";
  selectedGroupId.value = "";
  for (const { id } of MATERIAL_KINDS) {
    selectedMaterialIds[id] = props.book?.boundMaterialLibraryIdsByKind?.[id]?.[0] ?? "";
  }
  for (const { id } of SKILL_KINDS) {
    selectedSkillIds[id] = props.book?.boundSkillLibraryIdsByKind?.[id]?.[0] ?? "";
  }
}

watch(
  () => [props.mode, props.book] as const,
  () => {
    nameDraft.value = props.book?.label ?? "";
    resetBindingDraft();
    if (props.mode === "rename") {
      void nextTick(() => {
        nameInput.value?.focus();
        nameInput.value?.select();
      });
    }
  },
  { immediate: true }
);

watch(availableGroups, (groups) => {
  if (selectedGroupId.value && !groups.some((group) => group.id === selectedGroupId.value)) {
    selectedGroupId.value = "";
  }
});

function submit(): void {
  if (!props.book || !props.mode || props.submitting) return;
  if (props.mode === "rename") {
    const label = nameDraft.value.trim();
    if (!label) {
      uiMessage.warning("请输入书籍名称");
      nameInput.value?.focus();
      return;
    }
    emit("rename", { bookId: props.book.id, label });
    return;
  }
  if (props.mode === "remove") {
    emit("remove", props.book.id);
    return;
  }
  if (bindingDomain.value === "material") {
    emit("updateBindings", {
      bookId: props.book.id,
      domain: "material",
      linksByKind: bindingMode.value === "group"
        ? materialGroupLinks(selectedMaterialGroup.value)
        : Object.fromEntries(MATERIAL_KINDS.map(({ id }) => [id, selectedMaterialIds[id] ? [selectedMaterialIds[id]] : []])) as LinkedMaterialIdsByKind
    });
  } else if (bindingDomain.value === "skill") {
    emit("updateBindings", {
      bookId: props.book.id,
      domain: "skill",
      linksByKind: bindingMode.value === "group"
        ? skillGroupLinks(selectedSkillGroup.value)
        : Object.fromEntries(SKILL_KINDS.map(({ id }) => [id, selectedSkillIds[id] ? [selectedSkillIds[id]] : []])) as LinkedSkillIdsByKind
    });
  }
}

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.mode && event.key === "Escape") requestClose();
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="mode && book" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog book-resource-dialog"
        :class="{ 'book-binding-dialog': bindingDomain }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`book-resource-dialog-${mode}`"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ book.label }}</span>
            <h2 :id="`book-resource-dialog-${mode}`">{{ title }}</h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭" :disabled="submitting" @click="requestClose">×</button>
        </header>

        <form class="dialog-content" :class="{ 'create-short-book-form': bindingDomain }" @submit.prevent="submit">
          <template v-if="mode === 'rename'">
            <label class="book-resource-name-field">
              <span>书籍名称</span>
              <input ref="nameInput" v-model="nameDraft" type="text" maxlength="80" autocomplete="off" aria-label="书籍名称" />
            </label>
            <p class="book-resource-help">侧栏和文稿显示路径会同步更新，本地文件夹名称不会被自动修改。</p>
          </template>

          <template v-else-if="mode === 'remove'">
            <div class="book-remove-warning">
              <AppIcon name="trash" :size="20" />
              <div>
                <strong>确认移除“{{ book.label }}”？</strong>
                <p>只会从当前创作空间解除注册，不会删除本地文件夹；之后可通过“打开已存在书籍”恢复。</p>
              </div>
            </div>
          </template>

          <section v-else class="create-short-binding-panel" :aria-labelledby="`book-binding-heading-${mode}`">
            <div class="create-short-binding-heading">
              <span class="create-short-binding-icon">
                <AppIcon :name="bindingDomain === 'skill' ? 'library' : 'archive'" :size="17" />
              </span>
              <div>
                <h3 :id="`book-binding-heading-${mode}`">{{ bindingDomain === "skill" ? "绑定技能库" : "关联素材库" }}</h3>
                <p>{{ bindingDomain === "skill" ? "智能体只会按当前阶段和读取范围加载已绑定技能。" : "按用途选择素材库；未选择的分类可稍后补充。" }}</p>
              </div>
            </div>

            <div class="create-short-binding-modes" role="radiogroup" :aria-label="bindingDomain === 'skill' ? '技能库绑定方式' : '素材库关联方式'">
              <label :class="{ 'is-selected': bindingMode === 'single' }">
                <input v-model="bindingMode" type="radio" value="single" :disabled="submitting" />
                按分类选择
              </label>
              <label :class="{ 'is-selected': bindingMode === 'group' }" :title="availableGroups.length ? '' : `暂无可用${bindingDomain === 'skill' ? '技能' : '素材'}分组`">
                <input v-model="bindingMode" type="radio" value="group" :disabled="submitting || availableGroups.length === 0" />
                选择分组
              </label>
            </div>

            <div v-if="bindingMode === 'single' && bindingDomain === 'material'" class="create-short-kind-grid">
              <label v-for="kind in MATERIAL_KINDS" :key="kind.id" class="create-short-kind-field">
                <span><strong>{{ kind.label }}</strong><small>{{ kind.description }}</small></span>
                <PopupSelect
                  :model-value="selectedMaterialIds[kind.id]"
                  :options="materialOptions(kind.id)"
                  :accessible-label="kind.label"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="selectedMaterialIds[kind.id] = String($event)"
                />
              </label>
            </div>
            <div v-else-if="bindingMode === 'single'" class="create-short-kind-grid">
              <label v-for="kind in SKILL_KINDS" :key="kind.id" class="create-short-kind-field">
                <span><strong>{{ kind.label }}</strong><small>{{ kind.description }}</small></span>
                <PopupSelect
                  :model-value="selectedSkillIds[kind.id]"
                  :options="skillOptions(kind.id)"
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
                <span>{{ bindingDomain === "skill" ? "技能分组" : "素材分组" }}</span>
                <PopupSelect
                  :model-value="selectedGroupId"
                  :options="groupOptions"
                  :accessible-label="bindingDomain === 'skill' ? '技能分组' : '素材分组'"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="selectedGroupId = String($event)"
                />
              </label>
              <div v-if="bindingDomain === 'material' && selectedMaterialGroup" class="create-short-group-members">
                <span v-for="kind in MATERIAL_KINDS" :key="kind.id">
                  <small>{{ kind.label }}</small>
                  <strong>{{ materialLibraries.find((library) => library.id === selectedMaterialGroup?.members[kind.id])?.label ?? "未配置" }}</strong>
                </span>
              </div>
              <div v-else-if="bindingDomain === 'skill' && selectedSkillGroup" class="create-short-group-members">
                <span v-for="kind in SKILL_KINDS" :key="kind.id">
                  <small>{{ kind.label }}</small>
                  <strong>{{ skillLibraries.find((library) => library.id === selectedSkillGroup?.members[kind.id])?.label ?? "未配置" }}</strong>
                </span>
              </div>
              <p v-else class="create-short-stable-hint">选择分组后，会一次{{ bindingDomain === "skill" ? "绑定" : "关联" }}其中已配置的各类{{ bindingDomain === "skill" ? "技能库" : "素材库" }}。</p>
            </div>
          </section>

          <p v-if="bindingDomain && loading" class="create-short-stable-hint">正在加载素材库和技能库目录…</p>

          <div class="dialog-actions" :class="{ 'create-short-book-actions': bindingDomain }">
            <button class="dialog-secondary-button" type="button" :disabled="submitting" @click="requestClose">取消</button>
            <button class="dialog-primary-button" :class="{ 'is-danger': mode === 'remove' }" type="submit" :disabled="loading || submitting">
              {{ submitting ? "保存中…" : mode === "remove" ? "确认移除" : mode === "rename" ? "保存名称" : "保存绑定" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
