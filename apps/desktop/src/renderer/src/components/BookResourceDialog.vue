<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  BookResourceDialogMode,
  ResourceDomain,
  ResourceTreeNode
} from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  mode: BookResourceDialogMode | null;
  book: ResourceTreeNode | null;
  skillLibraries: ResourceTreeNode[];
  materialLibraries: ResourceTreeNode[];
}>();

const emit = defineEmits<{
  close: [];
  rename: [payload: { bookId: string; label: string }];
  remove: [bookId: string];
  updateBindings: [payload: { bookId: string; domain: Extract<ResourceDomain, "skill" | "material">; libraryIds: string[] }];
}>();

const nameDraft = ref("");
const selectedLibraryIds = ref<string[]>([]);
const nameInput = ref<HTMLInputElement | null>(null);

const bindingDomain = computed<"skill" | "material" | null>(() => {
  if (props.mode === "bind-skill") return "skill";
  if (props.mode === "bind-material") return "material";
  return null;
});
const libraries = computed(() => {
  const available =
    bindingDomain.value === "skill" ? props.skillLibraries : props.materialLibraries;
  const availableIds = new Set(available.map(({ id }) => id));
  const boundIds =
    bindingDomain.value === "skill"
      ? props.book?.boundSkillLibraryIds ?? []
      : props.book?.boundMaterialLibraryIds ?? [];
  const missing = boundIds
    .filter((id) => !availableIds.has(id))
    .map<ResourceTreeNode>((id) => ({
      id,
      label: `已丢失的${bindingDomain.value === "skill" ? "技能" : "素材"}库（${id}）`,
      icon: bindingDomain.value === "skill" ? "library" : "archive",
      badge: "缺失",
      muted: true,
      catalogNodeType: "library",
      libraryId: id
    }));
  return [...available, ...missing];
});
const title = computed(() => {
  if (props.mode === "rename") return "修改书籍名称";
  if (props.mode === "remove") return "移除书籍";
  if (props.mode === "bind-skill") return "技能库绑定";
  return "素材库绑定";
});

watch(
  () => [props.mode, props.book] as const,
  () => {
    nameDraft.value = props.book?.label ?? "";
    selectedLibraryIds.value =
      props.mode === "bind-skill"
        ? [...(props.book?.boundSkillLibraryIds ?? [])]
        : props.mode === "bind-material"
          ? [...(props.book?.boundMaterialLibraryIds ?? [])]
          : [];
    if (props.mode === "rename") {
      void nextTick(() => {
        nameInput.value?.focus();
        nameInput.value?.select();
      });
    }
  },
  { immediate: true }
);

function toggleLibrary(libraryId: string): void {
  selectedLibraryIds.value = selectedLibraryIds.value.includes(libraryId)
    ? selectedLibraryIds.value.filter((id) => id !== libraryId)
    : [...selectedLibraryIds.value, libraryId];
}

function submit(): void {
  if (!props.book || !props.mode) {
    return;
  }
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
  if (bindingDomain.value) {
    emit("updateBindings", {
      bookId: props.book.id,
      domain: bindingDomain.value,
      libraryIds: [...selectedLibraryIds.value]
    });
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (!props.mode) {
    return;
  }
  if (event.key === "Escape") {
    emit("close");
  }
}

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="mode && book" class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        class="workspace-dialog book-resource-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`book-resource-dialog-${mode}`"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{ book.label }}</span>
            <h2 :id="`book-resource-dialog-${mode}`">{{ title }}</h2>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <form class="dialog-content" @submit.prevent="submit">
          <template v-if="mode === 'rename'">
            <label class="book-resource-name-field">
              <span>书籍名称</span>
              <input
                ref="nameInput"
                v-model="nameDraft"
                type="text"
                maxlength="80"
                autocomplete="off"
                aria-label="书籍名称"
              />
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

          <template v-else>
            <p class="dialog-description">
              选择要绑定到“{{ book.label }}”的{{ bindingDomain === "skill" ? "技能库" : "素材库" }}。
            </p>
            <div v-if="libraries.length" class="book-binding-list">
              <label v-for="library in libraries" :key="library.id" class="book-binding-option">
                <input
                  type="checkbox"
                  :checked="selectedLibraryIds.includes(library.id)"
                  @change="toggleLibrary(library.id)"
                />
                <span class="book-binding-icon">
                  <AppIcon :name="library.icon ?? (bindingDomain === 'skill' ? 'library' : 'archive')" :size="17" />
                </span>
                <span>
                  <strong>{{ library.label }}</strong>
                  <small>
                    {{ library.badge ? `${library.badge} · ` : "" }}{{ selectedLibraryIds.includes(library.id) ? "已选择" : "未绑定" }}
                  </small>
                </span>
              </label>
            </div>
            <p v-else class="book-binding-empty">
              暂无可绑定的{{ bindingDomain === "skill" ? "技能库" : "素材库" }}。
            </p>
          </template>

          <div class="dialog-actions">
            <button class="dialog-secondary-button" type="button" @click="emit('close')">取消</button>
            <button
              class="dialog-primary-button"
              :class="{ 'is-danger': mode === 'remove' }"
              type="submit"
            >
              {{ mode === "remove" ? "确认移除" : mode === "rename" ? "保存名称" : "保存绑定" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
