<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { useBookResourceBindings } from "../composables/useBookResourceBindings";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialLibraryGroup,
  SkillLibraryGroup
} from "@deepwrite/contracts";
import type {
  BookResourceDialogMode,
  ResourceTreeNode
} from "../types/workspace";
import { uiMessage } from "../ui-feedback";
import { sharingT } from "./librarySharingLabels";
import { academicTreeT } from "./academic/academicTreeLabels";
import AppIcon from "./AppIcon.vue";
import PopupSelect from "./PopupSelect.vue";

const t = createScopedTranslator("components.bookResourceDialog");

const props = withDefaults(
  defineProps<{
    mode: BookResourceDialogMode | null;
    book: ResourceTreeNode | null;
    skillLibraries: ResourceTreeNode[];
    materialLibraries: ResourceTreeNode[];
    materialGroups?: readonly MaterialLibraryGroup[];
    skillGroups?: readonly SkillLibraryGroup[];
    loading?: boolean;
    submitting?: boolean;
  }>(),
  {
    materialGroups: () => [],
    skillGroups: () => [],
    loading: false,
    submitting: false
  }
);

type BindingPayload =
  | { bookId: string; domain: "skill"; linksByKind: LinkedSkillIdsByKind }
  | {
      bookId: string;
      domain: "material";
      linksByKind: LinkedMaterialIdsByKind;
    };

const emit = defineEmits<{
  close: [];
  rename: [payload: { bookId: string; label: string }];
  remove: [bookId: string];
  delete: [bookId: string];
  updateBindings: [payload: BindingPayload];
}>();

const {
  selectedIds,
  selectedSet,
  searchQuery,
  tagFilter,
  tagFilterOptions,
  activeItems,
  filteredItems,
  bindingDomain,
  availableGroups,
  groupMemberCount,
  isGroupSelected,
  toggleGroup,
  toggleLibrary,
  selectedMaterialLinks,
  selectedSkillLinks,
  resetBindingDraft
} = useBookResourceBindings(props);

const nameDraft = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

const bookTypeLabel = computed(() =>
  props.book?.workspaceType === "academic"
    ? academicTreeT("academicWork")
    : props.book?.workspaceType === "script"
      ? t("screenplay")
      : t("book")
);
const title = computed(() => {
  if (props.mode === "rename")
    return t("renameValue", {
      arg0: bookTypeLabel.value
    });
  if (props.mode === "remove")
    return t("removeValue", {
      arg0: bookTypeLabel.value
    });
  if (props.mode === "delete")
    return t("deleteValue", {
      arg0: bookTypeLabel.value
    });
  if (props.mode === "bind-skill") return t("skillLibraryLinks");
  return t("materialLibraryLinks");
});

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

function submit(): void {
  if (!props.book || !props.mode || props.submitting) return;
  if (props.mode === "rename") {
    const label = nameDraft.value.trim();
    if (!label) {
      uiMessage.warning(t("enterABookName"));
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
  if (props.mode === "delete") {
    emit("delete", props.book.id);
    return;
  }
  if (bindingDomain.value === "material") {
    emit("updateBindings", {
      bookId: props.book.id,
      domain: "material",
      linksByKind: selectedMaterialLinks()
    });
  } else if (bindingDomain.value === "skill") {
    emit("updateBindings", {
      bookId: props.book.id,
      domain: "skill",
      linksByKind: selectedSkillLinks()
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
    <div
      v-if="mode && book"
      class="dialog-backdrop"
      @mousedown.self="requestClose"
    >
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
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="submitting"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form
          class="dialog-content"
          :class="{ 'create-short-book-form': bindingDomain }"
          @submit.prevent="submit"
        >
          <template v-if="mode === 'rename'">
            <label class="book-resource-name-field">
              <span>{{
                t("nameMessage", {
                  arg0: bookTypeLabel ?? ""
                })
              }}</span>
              <input
                ref="nameInput"
                v-model="nameDraft"
                type="text"
                maxlength="80"
                autocomplete="off"
                :aria-label="
                  t('valueName', {
                    arg0: bookTypeLabel
                  })
                "
              />
            </label>
            <p class="book-resource-help">
              {{ t("theSidebarAndManuscriptDisplayPathsWillUpdateThe") }}
            </p>
          </template>

          <template v-else-if="mode === 'remove' || mode === 'delete'">
            <div class="book-remove-warning">
              <AppIcon name="trash" :size="20" />
              <div>
                <strong>{{
                  t("summaryMessage", {
                    arg0: (mode === "delete" ? t("delete") : t("remove")) ?? "",
                    arg1: book.label ?? ""
                  })
                }}</strong>
                <p v-if="mode === 'delete'">
                  {{ t("willBeRemovedFromTheWorkspaceAndItsLocal") }}
                </p>
                <p v-else>
                  {{
                    t("thisOnlyUnregistersTheWorkFromTheMessage", {
                      arg0: bookTypeLabel ?? ""
                    })
                  }}
                </p>
              </div>
            </div>
          </template>

          <section
            v-else
            class="create-short-binding-panel lib-picker-stack"
            :aria-labelledby="`book-binding-heading-${mode}`"
          >
            <div class="create-short-binding-heading">
              <span class="create-short-binding-icon">
                <AppIcon
                  :name="bindingDomain === 'skill' ? 'library' : 'archive'"
                  :size="17"
                />
              </span>
              <div>
                <h3 :id="`book-binding-heading-${mode}`">
                  {{
                    bindingDomain === "skill"
                      ? t("linkSkillLibraries")
                      : t("linkMaterialLibraries")
                  }}
                </h3>
                <p>
                  {{
                    bindingDomain === "skill"
                      ? t("linkedSkillsCanBeLoadedAsNeededAtAny")
                      : t("linkedMaterialsCanBeLoadedAsNeededAtAny")
                  }}
                </p>
              </div>
            </div>

            <div v-if="availableGroups.length" class="lib-picker-groups">
              <span class="lib-picker-groups-label">{{
                sharingT("quickSelectGroups")
              }}</span>
              <div class="lib-picker-group-chips">
                <button
                  v-for="group in availableGroups"
                  :key="group.id"
                  class="lib-picker-group-chip"
                  :class="{ 'is-active': isGroupSelected(group) }"
                  type="button"
                  :disabled="loading || submitting"
                  @click="toggleGroup(group.id)"
                >
                  <span>{{ group.title }}</span>
                  <span class="lib-picker-group-count">{{
                    sharingT("groupMemberCount", {
                      count: groupMemberCount(group)
                    })
                  }}</span>
                </button>
              </div>
            </div>

            <div class="lib-picker-toolbar">
              <input
                v-model="searchQuery"
                class="lib-picker-search-input"
                type="search"
                autocomplete="off"
                :placeholder="sharingT('searchLibrariesPlaceholder')"
                :aria-label="sharingT('searchLibrariesPlaceholder')"
                :disabled="loading || submitting"
              />
              <PopupSelect
                :model-value="tagFilter"
                :options="tagFilterOptions"
                :accessible-label="sharingT('filterByTag')"
                size="large"
                :disabled="loading || submitting"
                :menu-min-width="160"
                @update:model-value="tagFilter = String($event)"
              />
            </div>

            <div
              v-if="filteredItems.length"
              class="lib-picker-list"
              role="group"
              :aria-label="title"
            >
              <label
                v-for="item in filteredItems"
                :key="item.id"
                class="lib-picker-row"
                :class="{ 'is-checked': selectedSet.has(item.id) }"
              >
                <span class="lib-picker-row-main">
                  <input
                    type="checkbox"
                    :checked="selectedSet.has(item.id)"
                    :disabled="loading || submitting"
                    @change="toggleLibrary(item.id)"
                  />
                  <span class="lib-picker-row-title">{{ item.title }}</span>
                </span>
                <span class="lib-picker-row-meta">
                  <span class="lib-picker-tag-badge">{{ item.tag }}</span>
                  <span class="lib-picker-entry-count">{{
                    sharingT("entryCount", { count: item.entryCount })
                  }}</span>
                </span>
              </label>
            </div>
            <p v-else class="lib-picker-empty">
              {{
                activeItems.length === 0
                  ? sharingT("noLibrariesAvailable")
                  : sharingT("noMatchingLibraries")
              }}
            </p>
            <span class="lib-picker-count">
              {{ sharingT("selectedCount", { count: selectedIds.length }) }}
            </span>
          </section>

          <div
            class="dialog-actions"
            :class="{ 'create-short-book-actions': bindingDomain }"
          >
            <span
              v-if="bindingDomain && loading"
              class="dialog-action-status"
              aria-live="polite"
            >
              {{ t("loadingMaterialAndSkillLibraries") }}
            </span>
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="submitting"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              :class="{ 'is-danger': mode === 'delete' }"
              type="submit"
              :disabled="loading || submitting"
            >
              {{
                submitting
                  ? mode === "remove" || mode === "delete"
                    ? t("processing")
                    : t("saving")
                  : mode === "delete"
                    ? t("deleteLabel")
                    : mode === "remove"
                      ? t("confirmRemoval")
                      : mode === "rename"
                        ? t("saveName")
                        : t("saveLinks")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./library-sharing-picker.css"></style>
