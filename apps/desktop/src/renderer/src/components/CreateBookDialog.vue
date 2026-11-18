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
  ACADEMIC_BOOK_SUBTYPES,
  ACADEMIC_CITATION_STYLES,
  DEFAULT_ACADEMIC_FRAMEWORK_STAGES,
  LONG_BOOK_GENRES,
  MYSTERY_BOOK_GENRES,
  SCRIPT_BOOK_GENRES,
  SHORT_BOOK_GENRES,
  LongBookGenreSchema,
  MysteryBookGenreSchema,
  ScriptBookGenreSchema,
  ShortBookGenreSchema,
  getAcademicSubtypePreset,
  type AcademicBookSubtype,
  type AcademicCitationStyle
} from "@deepwrite/contracts/renderer";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialLibrary,
  MaterialLibraryGroup,
  MysteryNarrativePerson,
  SkillLibrary,
  SkillLibraryGroup
} from "@deepwrite/contracts";
import { mysteryLabels } from "../features/mystery/mysterySharedLabels";
import { uiMessage } from "../ui-feedback";
import BookAgentTeamBindings from "./BookAgentTeamBindings.vue";
import BookLibraryBindings from "./BookLibraryBindings.vue";
import PopupSelect, { type PopupSelectValue } from "./PopupSelect.vue";
import {
  academicCitationStyleDescription,
  academicSubtypeDescription,
  academicT
} from "./academic/academicLabels";
import {
  academicCitationStyleLabel,
  academicFrameworkStageLabel,
  academicSubtypeLabel
} from "./academic/academicTreeLabels";
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
const workspaceType = ref<"short" | "script" | "long" | "academic" | "mystery">(
  "short"
);
const genre = ref<string>("世情");
const academicSubtype = ref<AcademicBookSubtype>("empirical_paper");
const academicCitationStyle = ref<AcademicCitationStyle>(
  getAcademicSubtypePreset("empirical_paper").defaultCitationStyle
);
const academicStageIds = ref<string[]>([
  ...getAcademicSubtypePreset("empirical_paper").enabledStageIds
]);
const mysteryPlayerCount = ref(6);
const mysteryActCountTarget = ref(4);
const mysteryNarrativePerson = ref<MysteryNarrativePerson>("second");
const mysteryNarrativeOptions = computed(() => [
  { value: "second", label: mysteryLabels("secondPerson") },
  { value: "first", label: mysteryLabels("firstPerson") }
]);
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
  },
  {
    value: "academic",
    get label() {
      return academicT("academicWriting");
    },
    get description() {
      return academicT("academicWritingDesc");
    }
  },
  {
    value: "mystery",
    get label() {
      return mysteryLabels("murderMystery");
    },
    get description() {
      return mysteryLabels("mysteryTypeDescription");
    }
  }
] as const;
const academicCitationOptions = computed(() =>
  ACADEMIC_CITATION_STYLES.map((style) => ({
    value: style,
    label: academicCitationStyleLabel(style),
    description: academicCitationStyleDescription(style)
  }))
);
const genreOptions = computed<readonly string[]>(() =>
  workspaceType.value === "long"
    ? LONG_BOOK_GENRES
    : workspaceType.value === "mystery"
      ? MYSTERY_BOOK_GENRES
      : workspaceType.value === "script"
        ? SCRIPT_BOOK_GENRES
        : SHORT_BOOK_GENRES
);
const titleInput = ref<HTMLInputElement | null>(null);
const bindings = ref<{
  linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  linkedSkillIdsByKind: LinkedSkillIdsByKind;
  linkedMaterialIds: string[];
  linkedSkillIds: string[];
}>();
const agentTeamIds = ref<string[]>([]);
function workspaceTypeLabel(): string {
  return (
    workspaceTypeOptions.find((option) => option.value === workspaceType.value)
      ?.label ?? t("shortStory")
  );
}

function applyAcademicSubtypePreset(subtype: AcademicBookSubtype): void {
  const preset = getAcademicSubtypePreset(subtype);
  academicSubtype.value = subtype;
  academicCitationStyle.value = preset.defaultCitationStyle;
  academicStageIds.value = [...preset.enabledStageIds];
}

function selectAcademicCitationStyle(value: PopupSelectValue): void {
  if (ACADEMIC_CITATION_STYLES.includes(value as AcademicCitationStyle)) {
    academicCitationStyle.value = value as AcademicCitationStyle;
  }
}

function selectMysteryNarrativePerson(value: PopupSelectValue): void {
  if (value === "first" || value === "second") {
    mysteryNarrativePerson.value = value;
  }
}

function toggleAcademicStage(stageId: string, checked: boolean): void {
  const current = new Set(academicStageIds.value);
  if (checked) {
    current.add(stageId);
  } else {
    if (current.size <= 1) {
      uiMessage.warning(academicT("keepAtLeastOneFrameworkStage"));
      return;
    }
    current.delete(stageId);
  }
  academicStageIds.value = DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map(
    (stage) => stage.id
  ).filter((id) => current.has(id));
}

function resetDraft(): void {
  title.value = "";
  workspaceType.value = "short";
  genre.value = "世情";
  applyAcademicSubtypePreset("empirical_paper");
  mysteryPlayerCount.value = 6;
  mysteryActCountTarget.value = 4;
  mysteryNarrativePerson.value = "second";
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
  if (workspaceType.value === "academic") {
    if (!academicStageIds.value.length) {
      uiMessage.warning(academicT("keepAtLeastOneFrameworkStage"));
      return;
    }
    emit("submit", {
      workspaceType: "academic",
      title: normalizedTitle,
      subtype: academicSubtype.value,
      citationStyle: academicCitationStyle.value,
      defaultFrameworkStageIds: [...academicStageIds.value],
      linkedMaterialIds: bindings.value?.linkedMaterialIds ?? [],
      linkedSkillIds: bindings.value?.linkedSkillIds ?? [],
      ...teamChoice
    });
    return;
  }
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
  if (workspaceType.value === "mystery") {
    const linkedMaterialIds = bindings.value?.linkedMaterialIds ?? [
      ...new Set(Object.values(linkedMaterialIdsByKind ?? {}).flat())
    ];
    const linkedSkillIds = bindings.value?.linkedSkillIds ?? [
      ...new Set(Object.values(linkedSkillIdsByKind ?? {}).flat())
    ];
    emit("submit", {
      workspaceType: "mystery",
      title: normalizedTitle,
      genre: MysteryBookGenreSchema.parse(genre.value),
      boardSpec: {
        playerCount: Math.min(
          16,
          Math.max(2, Math.round(mysteryPlayerCount.value || 6))
        ),
        actCountTarget: Math.min(
          12,
          Math.max(1, Math.round(mysteryActCountTarget.value || 4))
        ),
        narrativePerson: mysteryNarrativePerson.value
      },
      linkedMaterialIds,
      linkedSkillIds,
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
                    (workspaceType === "academic"
                      ? academicT("academicBookNoun")
                      : workspaceType === "long"
                        ? t("novelLabel")
                        : workspaceType === "mystery"
                          ? mysteryLabels("murderMystery")
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
                :maxlength="
                  workspaceType === 'long'
                    ? 256
                    : workspaceType === 'academic'
                      ? 120
                      : 80
                "
                autocomplete="off"
                :placeholder="
                  workspaceType === 'academic'
                    ? academicT('academicTitlePlaceholder')
                    : workspaceType === 'long'
                      ? t('enterANovelTitle')
                      : workspaceType === 'mystery'
                        ? mysteryLabels('enterMysteryTitle')
                        : t('enterABookTitle')
                "
                :disabled="submitting"
              />
            </label>

            <template v-if="workspaceType === 'academic'">
              <fieldset class="create-short-genre-field">
                <legend>{{ academicT("subtypeLabel") }}</legend>
                <div class="academic-subtype-grid">
                  <button
                    v-for="option in ACADEMIC_BOOK_SUBTYPES"
                    :key="option"
                    type="button"
                    class="academic-subtype-card"
                    :class="{ 'is-selected': academicSubtype === option }"
                    :disabled="submitting"
                    @click="applyAcademicSubtypePreset(option)"
                  >
                    <strong>{{ academicSubtypeLabel(option) }}</strong>
                    <small>{{ academicSubtypeDescription(option) }}</small>
                  </button>
                </div>
              </fieldset>

              <label class="create-short-book-field">
                <span>{{ academicT("citationStyleLabel") }}</span>
                <PopupSelect
                  :model-value="academicCitationStyle"
                  :options="academicCitationOptions"
                  :accessible-label="academicT('citationStyleLabel')"
                  :disabled="submitting"
                  :menu-z-index="2300"
                  @update:model-value="selectAcademicCitationStyle"
                />
                <small class="academic-create-hint">
                  {{ academicCitationStyleDescription(academicCitationStyle) }}
                </small>
              </label>

              <fieldset class="create-short-genre-field">
                <legend>{{ academicT("frameworkStagesEnabledLabel") }}</legend>
                <div class="academic-stage-checks">
                  <label
                    v-for="stage in DEFAULT_ACADEMIC_FRAMEWORK_STAGES"
                    :key="stage.id"
                    class="academic-stage-check"
                  >
                    <input
                      type="checkbox"
                      :checked="academicStageIds.includes(stage.id)"
                      :disabled="submitting"
                      @change="
                        toggleAcademicStage(
                          stage.id,
                          ($event.target as HTMLInputElement).checked
                        )
                      "
                    />
                    <span>{{ academicFrameworkStageLabel(stage) }}</span>
                  </label>
                </div>
              </fieldset>
            </template>

            <fieldset v-else class="create-short-genre-field">
              <legend>
                {{
                  workspaceType === "long"
                    ? t("novelGenre")
                    : workspaceType === "mystery"
                      ? mysteryLabels("mysteryGenre")
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

            <div
              v-if="workspaceType === 'mystery'"
              class="create-mystery-board-spec"
            >
              <label class="create-short-book-field">
                <span>{{ mysteryLabels("playerCount") }}</span>
                <input
                  v-model.number="mysteryPlayerCount"
                  type="number"
                  min="2"
                  max="16"
                  :disabled="submitting"
                />
              </label>
              <label class="create-short-book-field">
                <span>{{ mysteryLabels("actCountTarget") }}</span>
                <input
                  v-model.number="mysteryActCountTarget"
                  type="number"
                  min="1"
                  max="12"
                  :disabled="submitting"
                />
              </label>
              <label class="create-short-book-field">
                <span>{{ mysteryLabels("narrativePerson") }}</span>
                <PopupSelect
                  :model-value="mysteryNarrativePerson"
                  :options="mysteryNarrativeOptions"
                  :accessible-label="mysteryLabels('narrativePerson')"
                  :disabled="submitting"
                  align="end"
                  :menu-min-width="300"
                  :menu-z-index="2300"
                  @update:model-value="selectMysteryNarrativePerson"
                />
              </label>
            </div>
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
                  : workspaceType === "academic"
                    ? academicT("createAcademicBook")
                    : workspaceType === "long"
                      ? t("createNovel")
                      : workspaceType === "mystery"
                        ? mysteryLabels("createMystery")
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

<style scoped>
.academic-subtype-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.academic-subtype-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
  text-align: left;
  cursor: pointer;
}

.academic-subtype-card.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.academic-subtype-card strong {
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.academic-subtype-card small,
.academic-create-hint {
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--text-secondary);
}

.academic-stage-checks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.academic-stage-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--theme-line-soft);
  background: var(--surface-raised);
  font-size: 0.8125rem;
  color: var(--text-primary);
  cursor: pointer;
}
</style>
