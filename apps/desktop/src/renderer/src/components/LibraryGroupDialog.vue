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

const t = createScopedTranslator("components.libraryGroupDialog");

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
  get character() {
    return t("characterMaterialLibrary");
  },
  get gimmick() {
    return t("ideaMaterialLibrary");
  },
  get plot() {
    return t("plotMaterialLibrary");
  },
  get draft() {
    return t("manuscriptMaterialLibrary");
  },
  get other() {
    return t("otherMaterialLibrary");
  }
} as const;
const SKILL_LABELS = {
  get general() {
    return t("generalSkillLibrary");
  },
  get plot() {
    return t("plotDesignSkillLibrary");
  },
  get style() {
    return t("writingStyleSkillLibrary");
  },
  get other() {
    return t("otherSkillLibrary");
  }
} as const;

const title = ref("");
const titleInput = ref<HTMLInputElement | null>(null);
const selections = ref<Record<string, string>>({});
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
          { value: "", label: t("none") },
          {
            value: CREATE_DEFAULT_LIBRARY_VALUE,
            label: t("createDefaultLibrary"),
            description: t("createANewValueAndLinkItToThis", {
              arg0: MATERIAL_LABELS[kind]
            })
          },
          ...props.materials
            .filter(
              (library) =>
                !library.isUnbound &&
                (library.materialKind === kind ||
                  library.materialKind === "mixed") &&
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
          { value: "", label: t("none") },
          {
            value: CREATE_DEFAULT_LIBRARY_VALUE,
            label: t("createDefaultLibrary"),
            description: t("createANewValueAndLinkItToThis", {
              arg0: SKILL_LABELS[kind]
            })
          },
          ...props.skills
            .filter(
              (library) =>
                !library.isUnbound &&
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
  const groupTitle = title.value.trim() || t("group");
  return `${groupTitle} · ${kindLabel}`;
}

async function resolveMemberSelections(
  kinds: readonly string[]
): Promise<Record<string, string> | null> {
  const api = window.deepwrite;
  if (!api) {
    uiMessage.error(t("theDesktopBridgeIsNotReadyTryAgainShortly"));
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
      uiMessage.info(
        t("defaultLibraryCreationWasCanceledTheGroupOperationDid")
      );
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
  if (!name) {
    uiMessage.warning(t("enterAGroupName"));
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
              title: name,
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
              title: name,
              members,
              ...(props.group.projectRevision === undefined
                ? {}
                : { baseProjectRevision: props.group.projectRevision })
            }
          : { domain: "skill", name, members }
      );
    }
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("couldNotCreateTheDefaultLibrary")));
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
          Object.entries(props.group.members).filter(([, libraryId]) =>
            Boolean(libraryId)
          )
        ) as Record<string, string>)
      : {};
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
              {{
                t("chooseAtMostOneExistingLibraryPerMessage", {
                  arg0: domainLabel ?? ""
                })
              }}
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

          <fieldset class="library-group-members">
            <legend>
              {{
                t("selectLibrariesMessage", {
                  arg0: domainLabel ?? ""
                })
              }}
            </legend>
            <label
              v-for="row in rows"
              :key="row.kind"
              class="library-group-member-row"
            >
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
              {{ t("cancel") }}
            </button>
            <button
              class="dialog-primary-button"
              type="submit"
              :disabled="busy"
            >
              {{
                resolving
                  ? t("creatingDefaultLibrary")
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
