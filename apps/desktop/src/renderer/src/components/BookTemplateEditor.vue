<script setup lang="ts">
import { plotStageLabel } from "../i18n/plotStageLabels";
import { formatError } from "../i18n/errors";
import { genreLabel } from "./catalogLabels";
import { createScopedTranslator } from "../i18n";
import { computed, reactive, ref, toRaw } from "vue";
import {
  loadBookTemplateDraftSchema,
  DEFAULT_NEW_BOOK_ENABLED_PLOT_STAGE_IDS,
  SHORT_BOOK_GENRES,
  SCRIPT_BOOK_GENRES
} from "@deepwrite/contracts/renderer";
import type {
  BookTemplate,
  BookTemplateDraft,
  CatalogIndexSnapshot,
  SaveBookTemplateInput
} from "@deepwrite/contracts";
import PopupSelect from "./PopupSelect.vue";
import BookAgentTeamBindings from "./BookAgentTeamBindings.vue";
import BookLibraryBindings from "./BookLibraryBindings.vue";
import { bookTemplateReferenceError } from "../utils/bookTemplateReferences";
import { useSettingsStore } from "../stores/settingsStore";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.bookTemplateEditor");
const props = defineProps<{
  workspaceType: "short" | "script";
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
const draft = reactive<BookTemplateDraft>(
  initial
    ? structuredClone(toRaw(initial))
    : {
        name: "",
        workspaceType: props.workspaceType,
        genre: "世情",
        characterFormat: "text",
        defaultPlotStageIds: stages.length
          ? stages
          : props.catalog.creativePlotStages
              .slice(0, 1)
              .map((stage) => stage.id),
        linkedMaterialIdsByKind: {
          character: [],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] }
      }
);
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
const invalidStages = computed(() =>
  draft.defaultPlotStageIds.filter(
    (id) => !props.catalog.creativePlotStages.some((stage) => stage.id === id)
  )
);
function toggleStage(id: string, checked: boolean) {
  const ids = new Set(draft.defaultPlotStageIds);
  if (checked) ids.add(id);
  else ids.delete(id);
  draft.defaultPlotStageIds = [
    ...props.catalog.creativePlotStages.map((stage) => stage.id),
    ...invalidStages.value
  ].filter((value) => ids.has(value));
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
            {{ workspaceType === "short" ? t("shortStory") : t("screenplay") }}
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
          <label
            >{{ t("genre")
            }}<PopupSelect
              :model-value="draft.genre"
              :options="genres"
              :accessible-label="t('templateGenre')"
              :disabled="busy"
              @update:model-value="
                draft.genre = $event as BookTemplateDraft['genre']
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
            <label v-for="id in invalidStages" :key="id" class="template-stage"
              ><input
                type="checkbox"
                checked
                :disabled="busy"
                @change="toggleStage(id, false)"
              />{{
                t("unavailableStageDeselectAndSaveMessage", { arg0: id ?? "" })
              }}</label
            >
          </fieldset>
          <BookLibraryBindings
            :workspace-type="workspaceType"
            :materials="catalog.materials"
            :skills="catalog.skills"
            :material-groups="catalog.materialGroups"
            :skill-groups="catalog.skillGroups"
            :initial-materials="initial?.linkedMaterialIdsByKind"
            :initial-skills="initial?.linkedSkillIdsByKind"
            preserve-missing
            :submitting="busy"
            @change="Object.assign(draft, $event)"
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
