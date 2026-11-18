<script setup lang="ts">
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type {
  CreateLibraryGroupInput,
  MaterialLibrary,
  MaterialLibraryGroup,
  SkillLibrary,
  SkillLibraryGroup,
  UpdateLibraryGroupInput
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  formatMaterialTagBadge,
  formatSkillTagBadge,
  sharingT
} from "./librarySharingLabels";

const t = createScopedTranslator("components.libraryGroupDialog");

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

const title = ref("");
const titleInput = ref<HTMLInputElement | null>(null);
const searchQuery = ref("");
const quickCreateName = ref("");
const selectedMemberIds = ref<string[]>([]);
const locallyCreatedLibraries = ref<Array<MaterialLibrary | SkillLibrary>>([]);
const resolving = ref(false);

const editing = computed(() => Boolean(props.group));
const domainLabel = computed(() =>
  props.domain === "material" ? t("material") : t("skill")
);
const busy = computed(() => Boolean(props.submitting) || resolving.value);

const unavailableLibraryIds = computed(() => {
  const groups =
    props.domain === "material" ? props.materialGroups : props.skillGroups;
  return new Set(
    groups
      .filter((group) => group.id !== props.group?.id)
      .flatMap((group) => group.memberIds)
      .filter(Boolean)
  );
});

interface GroupCandidateItem {
  id: string;
  title: string;
  tag: string;
  entryCount: number;
}

const candidateLibraries = computed<GroupCandidateItem[]>(() => {
  const baseLibraries: ReadonlyArray<MaterialLibrary | SkillLibrary> =
    props.domain === "material" ? props.materials : props.skills;
  const merged = new Map<string, MaterialLibrary | SkillLibrary>();
  for (const library of baseLibraries) {
    merged.set(library.id, library);
  }
  for (const library of locallyCreatedLibraries.value) {
    if (!merged.has(library.id)) {
      merged.set(library.id, library);
    }
  }
  return [...merged.values()]
    .filter(
      (library) =>
        !library.isUnbound && !unavailableLibraryIds.value.has(library.id)
    )
    .map((library) => ({
      id: library.id,
      title: library.title,
      tag:
        "materialKind" in library
          ? formatMaterialTagBadge(library)
          : formatSkillTagBadge(library),
      entryCount: library.entries.length
    }));
});

const filteredLibraries = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return candidateLibraries.value;
  return candidateLibraries.value.filter(
    (item) =>
      item.title.toLocaleLowerCase().includes(query) ||
      item.tag.toLocaleLowerCase().includes(query)
  );
});

const selectedSet = computed(() => new Set(selectedMemberIds.value));

function toggleMember(libraryId: string): void {
  if (busy.value) return;
  if (selectedSet.value.has(libraryId)) {
    selectedMemberIds.value = selectedMemberIds.value.filter(
      (id) => id !== libraryId
    );
  } else {
    selectedMemberIds.value = [...selectedMemberIds.value, libraryId];
  }
}

async function quickCreateLibrary(): Promise<void> {
  if (busy.value) return;
  const api = window.deepwrite;
  if (!api) {
    uiMessage.error(t("theDesktopBridgeIsNotReadyTryAgainShortly"));
    return;
  }
  const fallbackTitle = `${title.value.trim() || t("group")} · ${domainLabel.value}`;
  const name = quickCreateName.value.trim() || fallbackTitle;
  resolving.value = true;
  try {
    const created =
      props.domain === "material"
        ? await api.catalog.createLibrary({
            domain: "material",
            name,
            materialKind: "other"
          })
        : await api.catalog.createLibrary({
            domain: "skill",
            name,
            skillKind: "general"
          });
    if (!created) return;
    locallyCreatedLibraries.value = [...locallyCreatedLibraries.value, created];
    if (!selectedMemberIds.value.includes(created.id)) {
      selectedMemberIds.value = [...selectedMemberIds.value, created.id];
    }
    quickCreateName.value = "";
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("couldNotCreateTheDefaultLibrary")));
  } finally {
    resolving.value = false;
  }
}

function requestClose(): void {
  if (!busy.value) emit("close");
}

function submit(): void {
  if (busy.value) return;
  const name = title.value.trim();
  if (!name) {
    uiMessage.warning(t("enterAGroupName"));
    titleInput.value?.focus();
    return;
  }
  const validIds = new Set(candidateLibraries.value.map((item) => item.id));
  const memberIds = selectedMemberIds.value.filter((id) => validIds.has(id));
  const baseRevision =
    props.group?.projectRevision === undefined
      ? {}
      : { baseProjectRevision: props.group.projectRevision };
  if (props.domain === "material") {
    emit(
      "submit",
      props.group
        ? {
            domain: "material",
            groupId: props.group.id,
            title: name,
            memberIds,
            ...baseRevision
          }
        : { domain: "material", name, memberIds }
    );
  } else {
    emit(
      "submit",
      props.group
        ? {
            domain: "skill",
            groupId: props.group.id,
            title: name,
            memberIds,
            ...baseRevision
          }
        : { domain: "skill", name, memberIds }
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
    searchQuery.value = "";
    quickCreateName.value = "";
    locallyCreatedLibraries.value = [];
    selectedMemberIds.value = props.group ? [...props.group.memberIds] : [];
    resolving.value = false;
    void nextTick(() => titleInput.value?.focus());
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
        class="workspace-dialog library-project-dialog library-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-group-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              t("libraryGroupMessage", {
                arg0: domainLabel ?? ""
              })
            }}</span>
            <h2 id="library-group-dialog-title">
              {{ editing ? t("editGroup") : t("newGroup") }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="busy"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <form
          class="dialog-content catalog-resource-form"
          @submit.prevent="submit"
        >
          <p class="dialog-description">
            <template v-if="editing">
              {{
                t("changeAndItsLinkedLibrariesRemovedLibrariesMessage", {
                  arg0: group?.title ?? "",
                  arg1: domainLabel ?? ""
                })
              }}
            </template>
            <template v-else>
              {{ sharingT("groupMultiSelectHint") }}
            </template>
          </p>
          <label class="book-resource-name-field">
            <span>{{ t("groupName") }}</span>
            <input
              ref="titleInput"
              v-model="title"
              type="text"
              maxlength="80"
              autocomplete="off"
              :placeholder="t('enterAGroupName')"
              :disabled="busy"
            />
          </label>

          <fieldset class="library-group-members lib-picker-stack">
            <legend>
              {{
                t("selectLibrariesMessage", {
                  arg0: domainLabel ?? ""
                })
              }}
            </legend>

            <div class="lib-picker-toolbar is-search-only">
              <input
                v-model="searchQuery"
                class="lib-picker-search-input"
                type="search"
                autocomplete="off"
                :placeholder="sharingT('searchLibrariesPlaceholder')"
                :aria-label="sharingT('searchLibrariesPlaceholder')"
                :disabled="busy"
              />
              <span class="lib-picker-count">
                {{
                  sharingT("selectedCount", { count: selectedMemberIds.length })
                }}
              </span>
            </div>

            <div
              v-if="filteredLibraries.length"
              class="lib-picker-list"
              role="group"
              :aria-label="
                t('selectLibrariesMessage', { arg0: domainLabel ?? '' })
              "
            >
              <label
                v-for="item in filteredLibraries"
                :key="item.id"
                class="lib-picker-row"
                :class="{ 'is-checked': selectedSet.has(item.id) }"
              >
                <span class="lib-picker-row-main">
                  <input
                    type="checkbox"
                    :checked="selectedSet.has(item.id)"
                    :disabled="busy"
                    @change="toggleMember(item.id)"
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
                candidateLibraries.length === 0
                  ? sharingT("noLibrariesAvailable")
                  : sharingT("noMatchingLibraries")
              }}
            </p>

            <div class="lib-picker-quick-create">
              <input
                v-model="quickCreateName"
                class="lib-picker-search-input"
                type="text"
                maxlength="80"
                autocomplete="off"
                :placeholder="sharingT('quickCreateLibraryPlaceholder')"
                :aria-label="sharingT('quickCreateLibraryPlaceholder')"
                :disabled="busy"
                @keydown.enter.prevent="quickCreateLibrary"
              />
              <button
                class="dialog-secondary-button"
                type="button"
                :disabled="busy"
                @click="quickCreateLibrary"
              >
                {{
                  resolving
                    ? sharingT("quickCreatingButton")
                    : sharingT("quickCreateButton")
                }}
              </button>
            </div>
          </fieldset>

          <div class="dialog-actions">
            <button
              class="dialog-secondary-button"
              type="button"
              :disabled="busy"
              @click="requestClose"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="busy"
            >
              {{
                resolving
                  ? sharingT("quickCreatingButton")
                  : submitting
                    ? editing
                      ? t("saving")
                      : t("creating")
                    : editing
                      ? t("saveGroup")
                      : t("createGroup")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./library-project-dialog.css"></style>
<style scoped src="./library-sharing-picker.css"></style>
