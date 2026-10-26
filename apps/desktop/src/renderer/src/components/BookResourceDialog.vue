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
  MATERIAL_KINDS,
  SKILL_KINDS,
  bindingMode,
  selectedGroupId,
  selectedMaterialIds,
  selectedSkillIds,
  bindingDomain,
  materialKindDescription,
  skillKindDescription,
  materialGroupLinks,
  skillGroupLinks,
  availableGroups,
  selectedMaterialGroup,
  selectedSkillGroup,
  groupOptions,
  materialOptions,
  skillOptions,
  selectedMaterialLinks,
  selectedSkillLinks,
  resetBindingDraft
} = useBookResourceBindings(props);

const nameDraft = ref("");
const nameInput = ref<HTMLInputElement | null>(null);

const bookTypeLabel = computed(() =>
  props.book?.workspaceType === "script" ? t("screenplay") : t("book")
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
      linksByKind:
        bindingMode.value === "group"
          ? materialGroupLinks(selectedMaterialGroup.value)
          : selectedMaterialLinks()
    });
  } else if (bindingDomain.value === "skill") {
    emit("updateBindings", {
      bookId: props.book.id,
      domain: "skill",
      linksByKind:
        bindingMode.value === "group"
          ? skillGroupLinks(selectedSkillGroup.value)
          : selectedSkillLinks()
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
            class="create-short-binding-panel"
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

            <div
              class="create-short-binding-modes"
              role="radiogroup"
              :aria-label="
                bindingDomain === 'skill'
                  ? t('skillLibraryLinking')
                  : t('materialLibraryLinking')
              "
            >
              <label :class="{ 'is-selected': bindingMode === 'single' }">
                <input
                  v-model="bindingMode"
                  type="radio"
                  value="single"
                  :disabled="submitting"
                />
                {{ t("chooseByCategory") }}
              </label>
              <label
                :class="{ 'is-selected': bindingMode === 'group' }"
                :title="
                  availableGroups.length
                    ? ''
                    : t('noValueGroupsAvailable', {
                        arg0:
                          bindingDomain === 'skill' ? t('skill') : t('material')
                      })
                "
              >
                <input
                  v-model="bindingMode"
                  type="radio"
                  value="group"
                  :disabled="submitting || availableGroups.length === 0"
                />
                {{ t("selectGroup") }}
              </label>
            </div>

            <div
              v-if="bindingMode === 'single' && bindingDomain === 'material'"
              class="create-short-kind-grid"
            >
              <label
                v-for="kind in MATERIAL_KINDS"
                :key="kind.id"
                class="create-short-kind-field"
              >
                <span
                  ><strong>{{ kind.label }}</strong
                  ><small>{{ materialKindDescription(kind) }}</small></span
                >
                <PopupSelect
                  :model-value="selectedMaterialIds[kind.id]"
                  :options="materialOptions(kind.id)"
                  :accessible-label="kind.label"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="
                    selectedMaterialIds[kind.id] = String($event)
                  "
                />
              </label>
            </div>
            <div
              v-else-if="bindingMode === 'single'"
              class="create-short-kind-grid"
            >
              <label
                v-for="kind in SKILL_KINDS"
                :key="kind.id"
                class="create-short-kind-field"
              >
                <span
                  ><strong>{{ kind.label }}</strong
                  ><small>{{ skillKindDescription(kind) }}</small></span
                >
                <PopupSelect
                  :model-value="selectedSkillIds[kind.id]"
                  :options="skillOptions(kind.id)"
                  :accessible-label="kind.label"
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="
                    selectedSkillIds[kind.id] = String($event)
                  "
                />
              </label>
            </div>
            <div v-else class="create-short-group-picker">
              <label class="create-short-book-field">
                <span>{{
                  bindingDomain === "skill"
                    ? t("skillGroup")
                    : t("materialGroup")
                }}</span>
                <PopupSelect
                  :model-value="selectedGroupId"
                  :options="groupOptions"
                  :accessible-label="
                    bindingDomain === 'skill'
                      ? t('skillGroup')
                      : t('materialGroup')
                  "
                  size="large"
                  :disabled="loading || submitting"
                  :menu-min-width="260"
                  @update:model-value="selectedGroupId = String($event)"
                />
              </label>
              <div
                v-if="bindingDomain === 'material' && selectedMaterialGroup"
                class="create-short-group-members"
              >
                <span v-for="kind in MATERIAL_KINDS" :key="kind.id">
                  <small>{{ kind.label }}</small>
                  <strong>{{
                    materialLibraries.find(
                      (library) =>
                        library.id === selectedMaterialGroup?.members[kind.id]
                    )?.label ?? t("notConfigured")
                  }}</strong>
                </span>
              </div>
              <div
                v-else-if="bindingDomain === 'skill' && selectedSkillGroup"
                class="create-short-group-members"
              >
                <span v-for="kind in SKILL_KINDS" :key="kind.id">
                  <small>{{ kind.label }}</small>
                  <strong>{{
                    skillLibraries.find(
                      (library) =>
                        library.id === selectedSkillGroup?.members[kind.id]
                    )?.label ?? t("notConfigured")
                  }}</strong>
                </span>
              </div>
              <p v-else class="create-short-stable-hint">
                {{
                  t("selectingAGroupWillAllConfiguredCategoriesMessage", {
                    arg0:
                      (bindingDomain === "skill"
                        ? t("link")
                        : t("linkLabel")) ?? "",
                    arg1:
                      (bindingDomain === "skill"
                        ? t("skillLibrary")
                        : t("materialLibrary")) ?? ""
                  })
                }}
              </p>
            </div>
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
