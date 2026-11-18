<script setup lang="ts">
import { plotStageLabel } from "../i18n/plotStageLabels";
import { formatError } from "../i18n/errors";
import { genreLabel } from "./catalogLabels";
import { createScopedTranslator } from "../i18n";
import { computed, reactive, ref, toRaw } from "vue";
import {
  ACADEMIC_BOOK_SUBTYPES,
  ACADEMIC_CITATION_STYLES,
  DEFAULT_ACADEMIC_FRAMEWORK_STAGES,
  DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS,
  SCRIPT_BOOK_GENRES,
  SHORT_BOOK_GENRES,
  getAcademicSubtypePreset,
  loadBookTemplateDraftSchema,
  type AcademicBookSubtype,
  type AcademicCitationStyle
} from "@deepwrite/contracts/renderer";
import type {
  BookTemplate,
  BookTemplateDraft,
  CatalogIndexSnapshot,
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  SaveBookTemplateInput
} from "@deepwrite/contracts";
import PopupSelect from "./PopupSelect.vue";
import BookAgentTeamBindings from "./BookAgentTeamBindings.vue";
import BookLibraryBindings from "./BookLibraryBindings.vue";
import { academicT } from "./academic/academicLabels";
import {
  academicCitationStyleLabel,
  academicFrameworkStageLabel,
  academicSubtypeLabel,
  academicTreeT
} from "./academic/academicTreeLabels";
import { bookTemplateReferenceError } from "../utils/bookTemplateReferences";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.bookTemplateEditor");
const props = defineProps<{
  workspaceType: "short" | "script" | "academic";
  template?: BookTemplate | undefined;
  catalog: CatalogIndexSnapshot;
  defaultStageIds: readonly string[];
  saving: boolean;
}>();
const emit = defineEmits<{ close: []; save: [input: SaveBookTemplateInput] }>();
const settingsStore = useSettingsStore();
const initial = props.template?.configuration;
const enabled = new Set(
  props.workspaceType === "short"
    ? props.defaultStageIds
    : DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS
);
const stages = props.catalog.creativePlotStages
  .filter((stage) => enabled.has(stage.id))
  .map((stage) => stage.id);

function createInitialDraft(): BookTemplateDraft {
  if (initial) {
    return structuredClone(toRaw(initial));
  }
  if (props.workspaceType === "academic") {
    const preset = getAcademicSubtypePreset("empirical_paper");
    return {
      name: "",
      workspaceType: "academic",
      subtype: "empirical_paper",
      citationStyle: preset.defaultCitationStyle,
      defaultFrameworkStageIds: [...preset.enabledStageIds],
      linkedMaterialIds: [],
      linkedSkillIds: []
    };
  }
  return {
    name: "",
    workspaceType: props.workspaceType,
    genre: "世情",
    characterFormat: "text",
    defaultPlotStageIds: stages.length
      ? stages
      : props.catalog.creativePlotStages.slice(0, 1).map((stage) => stage.id),
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] }
  };
}

const draft = reactive<BookTemplateDraft>(createInitialDraft());
const genres = computed(() =>
  (props.workspaceType === "short"
    ? SHORT_BOOK_GENRES
    : SCRIPT_BOOK_GENRES
  ).map((value) => ({
    value,
    get label() {
      return genreLabel(value);
    }
  }))
);
const academicSubtypeOptions = computed(() =>
  ACADEMIC_BOOK_SUBTYPES.map((value) => ({
    value,
    label: academicSubtypeLabel(value)
  }))
);
const academicCitationOptions = computed(() =>
  ACADEMIC_CITATION_STYLES.map((value) => ({
    value,
    label: academicCitationStyleLabel(value)
  }))
);
const invalidStages = computed(() =>
  draft.workspaceType === "academic"
    ? []
    : draft.defaultPlotStageIds.filter(
        (id) =>
          !props.catalog.creativePlotStages.some((stage) => stage.id === id)
      )
);
function toggleStage(id: string, checked: boolean) {
  if (draft.workspaceType === "academic") {
    const ids = new Set(draft.defaultFrameworkStageIds);
    if (checked) ids.add(id);
    else ids.delete(id);
    draft.defaultFrameworkStageIds = DEFAULT_ACADEMIC_FRAMEWORK_STAGES.map(
      (stage) => stage.id
    ).filter((value) => ids.has(value));
    return;
  }
  const ids = new Set(draft.defaultPlotStageIds);
  if (checked) ids.add(id);
  else ids.delete(id);
  draft.defaultPlotStageIds = [
    ...props.catalog.creativePlotStages.map((stage) => stage.id),
    ...invalidStages.value
  ].filter((value) => ids.has(value));
}
function handleLibraryChange(payload: {
  linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  linkedSkillIdsByKind: LinkedSkillIdsByKind;
  linkedMaterialIds: string[];
  linkedSkillIds: string[];
}) {
  if (draft.workspaceType === "academic") {
    draft.linkedMaterialIds = payload.linkedMaterialIds;
    draft.linkedSkillIds = payload.linkedSkillIds;
  } else {
    draft.linkedMaterialIdsByKind = payload.linkedMaterialIdsByKind;
    draft.linkedSkillIdsByKind = payload.linkedSkillIdsByKind;
  }
}
/** Unbound templates omit the field, so saving leaves them unchanged. */
function setAgentTeams(ids: string[]) {
  if (ids.length > 0) draft.linkedAgentTeamIds = ids;
  else delete draft.linkedAgentTeamIds;
}
const validating = ref(false);
const busy = computed(() => validating.value || props.saving);
async function submit() {
  if (validating.value || props.saving) return;
  validating.value = true;
  try {
    const schema = await loadBookTemplateDraftSchema();
    const result = schema.safeParse(draft);
    if (!result.success) {
      uiMessage.warning(
        !draft.name.trim()
          ? t("enterATemplateName")
          : t("selectAtLeastOnePlotStageAndCheckThe")
      );
      return;
    }
    const error = bookTemplateReferenceError(
      result.data,
      props.catalog,
      settingsStore.agentTeamCatalog
    );
    if (error) {
      uiMessage.warning(error);
      return;
    }
    emit("save", {
      ...(props.template ? { id: props.template.id } : {}),
      configuration: result.data
    });
  } catch (error) {
    uiMessage.error(
      formatError(error, t("templateValidationCouldNotLoadTryAgain"))
    );
  } finally {
    validating.value = false;
  }
}
</script>
<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop"
      @mousedown.self="!busy && emit('close')"
      @keydown.esc.stop="!busy && emit('close')"
    >
      <section
        class="workspace-dialog book-template-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-editor-title"
      >
        <header>
          <h2 id="template-editor-title">
            {{ template ? t("editTemplate") : t("newTemplateSettings") }}
            ·
            {{
              workspaceType === "academic"
                ? academicTreeT("academicWork")
                : workspaceType === "short"
                  ? t("shortStory")
                  : t("screenplay")
            }}
          </h2>
          <button
            class="dialog-close"
            :disabled="busy"
            :aria-label="t('close')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <form
          class="dialog-content book-template-form"
          @submit.prevent="submit"
        >
          <label
            >{{ t("templateName")
            }}<input
              v-model="draft.name"
              maxlength="80"
              :disabled="busy"
              autofocus
          /></label>
          <template v-if="draft.workspaceType === 'academic'">
            <label
              >{{ academicT("subtypeLabel")
              }}<PopupSelect
                :model-value="draft.subtype"
                :options="academicSubtypeOptions"
                :accessible-label="academicT('subtypeLabel')"
                :disabled="busy"
                :menu-z-index="2300"
                @update:model-value="
                  draft.subtype = $event as AcademicBookSubtype
                "
            /></label>
            <label
              >{{ academicT("citationStyleLabel")
              }}<PopupSelect
                :model-value="draft.citationStyle"
                :options="academicCitationOptions"
                :accessible-label="academicT('citationStyleLabel')"
                :disabled="busy"
                :menu-z-index="2300"
                @update:model-value="
                  draft.citationStyle = $event as AcademicCitationStyle
                "
            /></label>
            <fieldset>
              <legend>{{ academicT("frameworkStagesEnabledLabel") }}</legend>
              <label
                v-for="stage in DEFAULT_ACADEMIC_FRAMEWORK_STAGES"
                :key="stage.id"
                class="template-stage"
                ><input
                  type="checkbox"
                  :checked="draft.defaultFrameworkStageIds.includes(stage.id)"
                  :disabled="busy"
                  @change="
                    toggleStage(
                      stage.id,
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />{{ academicFrameworkStageLabel(stage) }}</label
              >
            </fieldset>
          </template>
          <template v-else>
            <label
              >{{ t("genre")
              }}<PopupSelect
                :model-value="draft.genre"
                :options="genres"
                :accessible-label="t('templateGenre')"
                :disabled="busy"
                @update:model-value="
                  draft.genre = $event as typeof draft.genre
                "
            /></label>
            <label
              >{{ t("defaultCharacterStyle")
              }}<PopupSelect
                v-model="draft.characterFormat"
                :options="[
                  {
                    value: 'text',
                    label: t('textStyle')
                  },
                  {
                    value: 'list',
                    label: t('entryStyle')
                  }
                ]"
                :accessible-label="t('defaultCharacterStyle')"
                :disabled="busy"
            /></label>
            <fieldset>
              <legend>
                {{ t("plotStagesEnabledByDefault") }}
              </legend>
              <label
                v-for="stage in catalog.creativePlotStages"
                :key="stage.id"
                class="template-stage"
                ><input
                  type="checkbox"
                  :checked="draft.defaultPlotStageIds.includes(stage.id)"
                  :disabled="busy"
                  @change="
                    toggleStage(
                      stage.id,
                      ($event.target as HTMLInputElement).checked
                    )
                  "
                />{{ plotStageLabel(stage) }}</label
              >
              <label
                v-for="id in invalidStages"
                :key="id"
                class="template-stage"
                ><input
                  type="checkbox"
                  checked
                  :disabled="busy"
                  @change="toggleStage(id, false)"
                />{{
                  t("unavailableStageDeselectAndSaveMessage", {
                    arg0: id ?? ""
                  })
                }}</label
              >
            </fieldset>
          </template>
          <BookLibraryBindings
            :workspace-type="workspaceType"
            :materials="catalog.materials"
            :skills="catalog.skills"
            :material-groups="catalog.materialGroups"
            :skill-groups="catalog.skillGroups"
            :initial-materials="
              initial && initial.workspaceType !== 'academic'
                ? initial.linkedMaterialIdsByKind
                : undefined
            "
            :initial-skills="
              initial && initial.workspaceType !== 'academic'
                ? initial.linkedSkillIdsByKind
                : undefined
            "
            :initial-material-ids="
              initial && initial.workspaceType === 'academic'
                ? initial.linkedMaterialIds
                : undefined
            "
            :initial-skill-ids="
              initial && initial.workspaceType === 'academic'
                ? initial.linkedSkillIds
                : undefined
            "
            preserve-missing
            :submitting="busy"
            @change="handleLibraryChange"
          />
          <BookAgentTeamBindings
            :model-value="draft.linkedAgentTeamIds ?? []"
            :workspace-type="workspaceType"
            :disabled="busy"
            @update:model-value="setAgentTeams"
          />
          <div class="dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="busy"
              @click="emit('close')"
            >
              {{ t("cancel") }}</button
            ><button
              class="dialog-primary-button"
              type="submit"
              :disabled="busy"
            >
              {{ busy ? t("saving") : t("saveTemplate") }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
<style src="./book-template.css"></style>
