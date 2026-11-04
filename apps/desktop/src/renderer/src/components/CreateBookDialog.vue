<script setup lang="ts">
import { genreLabel } from "./catalogLabels";
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  LONG_BOOK_GENRES,
  SCRIPT_BOOK_GENRES,
  SHORT_BOOK_GENRES,
  LongBookGenreSchema,
  ScriptBookGenreSchema,
  ShortBookGenreSchema
} from "@deepwrite/contracts";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialLibrary,
  MaterialLibraryGroup,
  SkillLibrary,
  SkillLibraryGroup
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import BookAgentTeamBindings from "./BookAgentTeamBindings.vue";
import BookLibraryBindings from "./BookLibraryBindings.vue";
import type { CreateCreativeBookPayload } from "./WorkspaceDialogLayer.types";

const t = createScopedTranslator("components.createBookDialog");

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
  submit: [payload: CreateCreativeBookPayload];
}>();

const title = ref("");
const workspaceType = ref<"short" | "script" | "long">("short");
const genre = ref<string>("世情");
const workspaceTypeOptions = [
  {
    value: "short",
    get label() {
      return t("shortStory");
    },
    get description() {
      return t("charactersPlotIntroductionOutlineAndManuscript");
    }
  },
  {
    value: "script",
    get label() {
      return t("screenplay");
    },
    get description() {
      return t("charactersPlotOutlineAndEpisodeManuscripts");
    }
  },
  {
    value: "long",
    get label() {
      return t("novel");
    },
    get description() {
      return t("worldbuildingCharactersPlotManuscriptAndContinuity");
    }
  }
] as const;
const genreOptions = computed<readonly string[]>(() =>
  workspaceType.value === "long"
    ? LONG_BOOK_GENRES
    : workspaceType.value === "script"
      ? SCRIPT_BOOK_GENRES
      : SHORT_BOOK_GENRES
);
const titleInput = ref<HTMLInputElement | null>(null);
const bindings = ref<{
  linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  linkedSkillIdsByKind: LinkedSkillIdsByKind;
}>();
const agentTeamIds = ref<string[]>([]);
function workspaceTypeLabel(): string {
  return (
    workspaceTypeOptions.find((option) => option.value === workspaceType.value)
      ?.label ?? t("shortStory")
  );
}

function resetDraft(): void {
  title.value = "";
  workspaceType.value = "short";
  genre.value = "世情";
  bindings.value = undefined;
  agentTeamIds.value = [];
}

function requestClose(): void {
  if (!props.submitting) emit("close");
}

function submit(): void {
  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) {
    uiMessage.warning(t("enterABookTitle"));
    titleInput.value?.focus();
    return;
  }
  const linkedMaterialIdsByKind = bindings.value?.linkedMaterialIdsByKind;
  const linkedSkillIdsByKind = bindings.value?.linkedSkillIdsByKind;
  const teamChoice = agentTeamIds.value.length
    ? { linkedAgentTeamIds: agentTeamIds.value }
    : {};
  if (workspaceType.value === "long") {
    if (Array.from(normalizedTitle).length > 256) {
      uiMessage.warning(t("novelTitlesCannotExceed256Characters"));
      titleInput.value?.focus();
      return;
    }
    emit("submit", {
      workspaceType: "long",
      title: normalizedTitle,
      genre: LongBookGenreSchema.parse(genre.value),
      linkedMaterialIdsByKind,
      linkedSkillIdsByKind,
      ...teamChoice
    });
    return;
  }
  if (workspaceType.value === "script") {
    emit("submit", {
      workspaceType: "script",
      title: normalizedTitle,
      genre: ScriptBookGenreSchema.parse(genre.value),
      linkedMaterialIdsByKind,
      linkedSkillIdsByKind,
      ...teamChoice
    });
    return;
  }
  emit("submit", {
    workspaceType: "short",
    title: normalizedTitle,
    genre: ShortBookGenreSchema.parse(genre.value),
    linkedMaterialIdsByKind,
    linkedSkillIdsByKind,
    ...teamChoice
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

watch(workspaceType, () => {
  genre.value = genreOptions.value[0] ?? "世情";
  bindings.value = undefined;
  agentTeamIds.value = [];
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
        aria-labelledby="create-book-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              t("workspaceMessage", {
                arg0: workspaceTypeLabel() ?? ""
              })
            }}</span>
            <h2 id="create-book-title">
              {{
                t("newMessage", {
                  arg0:
                    (workspaceType === "long"
                      ? t("novelLabel")
                      : workspaceType === "script"
                        ? t("screenplay")
                        : t("shortStoryLabel")) ?? ""
                })
              }}
            </h2>
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
          class="dialog-content create-short-book-form"
          @submit.prevent="submit"
        >
          <section
            class="create-short-book-basics"
            aria-labelledby="create-workspace-type-heading"
          >
            <h3 id="create-workspace-type-heading">
              {{ t("writingType") }}
            </h3>
            <div
              class="create-short-binding-modes create-workspace-type-options"
              role="tablist"
              :aria-label="t('writingType')"
            >
              <button
                v-for="option in workspaceTypeOptions"
                :key="option.value"
                class="create-workspace-type-tab"
                :class="{ 'is-selected': workspaceType === option.value }"
                type="button"
                role="tab"
                :aria-selected="workspaceType === option.value"
                :tabindex="workspaceType === option.value ? 0 : -1"
                :disabled="submitting"
                @click="workspaceType = option.value"
              >
                <span
                  ><strong>{{ option.label }}</strong
                  ><small>{{ option.description }}</small></span
                >
              </button>
            </div>
          </section>

          <section
            class="create-short-book-basics"
            aria-labelledby="create-short-basics-heading"
          >
            <h3 id="create-short-basics-heading">
              {{ t("bookInformation") }}
            </h3>
            <label class="create-short-book-field">
              <span>{{ t("bookTitle") }}</span>
              <input
                ref="titleInput"
                v-model="title"
                type="text"
                :maxlength="workspaceType === 'long' ? 256 : 80"
                autocomplete="off"
                :placeholder="
                  workspaceType === 'long'
                    ? t('enterANovelTitle')
                    : t('enterABookTitle')
                "
                :disabled="submitting"
              />
            </label>

            <fieldset class="create-short-genre-field">
              <legend>
                {{
                  workspaceType === "long"
                    ? t("novelGenre")
                    : t("valueCategory", {
                        arg0:
                          workspaceType === "script"
                            ? t("screenplay")
                            : t("shortStory")
                      })
                }}
              </legend>
              <div class="create-short-genre-options">
                <label
                  v-for="option in genreOptions"
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
                  <span>{{ genreLabel(option) }}</span>
                </label>
              </div>
            </fieldset>
          </section>

          <BookLibraryBindings
            :key="`${open}-${workspaceType}`"
            :materials="materials"
            :skills="skills"
            :material-groups="materialGroups"
            :skill-groups="skillGroups"
            :workspace-type="workspaceType"
            :loading="loading"
            :submitting="submitting"
            @change="bindings = $event"
          />
          <BookAgentTeamBindings
            v-model="agentTeamIds"
            :workspace-type="workspaceType"
            :disabled="submitting"
          />

          <div class="dialog-actions create-short-book-actions">
            <span
              v-if="loading"
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
              type="submit"
              :disabled="loading || submitting"
            >
              {{
                submitting
                  ? t("creating")
                  : workspaceType === "long"
                    ? t("createNovel")
                    : workspaceType === "script"
                      ? t("createScreenplay")
                      : t("createBook")
              }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
