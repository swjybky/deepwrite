<script setup lang="ts">
import { genreLabel } from "./catalogLabels";
import { DEFAULT_ACADEMIC_FRAMEWORK_STAGES } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import { computed, ref } from "vue";
import type { CreateCreativeBookPayload } from "./WorkspaceDialogLayer.types";
import PopupSelect from "./PopupSelect.vue";
import { academicT } from "./academic/academicLabels";
import {
  academicCitationStyleLabel,
  academicFrameworkStageLabel,
  academicSubtypeLabel,
  academicTreeT
} from "./academic/academicTreeLabels";
import { useBookTemplates } from "../composables/useBookTemplates";
import { bookTemplateReferenceError } from "../utils/bookTemplateReferences";
import { useBookAgentTeamCatalog } from "../composables/useBookAgentTeamBinding";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.createBookFromTemplateDialog");
const props = defineProps<{ submitting: boolean }>();
const emit = defineEmits<{
  close: [];
  submit: [input: CreateCreativeBookPayload];
  settings: [];
}>();
const { templates, catalog, loading, failed, load } = useBookTemplates();
const { catalog: teamCatalog } = useBookAgentTeamCatalog();
const templateId = ref("");
const title = ref("");
const selected = computed(() =>
  templates.value.find((item) => item.id === templateId.value)
);
const configuration = computed(() => selected.value?.configuration);
const options = computed(() =>
  templates.value.map((item) => ({
    value: item.id,
    label: t("valueValue", {
      arg0: item.configuration.name,
      arg1:
        item.configuration.workspaceType === "academic"
          ? academicTreeT("academicWork")
          : item.configuration.workspaceType === "short"
            ? t("shortStory")
            : t("screenplay")
    })
  }))
);
const stageSummary = computed(() => {
  const config = configuration.value;
  if (!config) return "";
  if (config.workspaceType === "academic") {
    return config.defaultFrameworkStageIds
      .map((id) => {
        const stage = DEFAULT_ACADEMIC_FRAMEWORK_STAGES.find(
          (candidate) => candidate.id === id
        );
        return stage ? academicFrameworkStageLabel(stage) : id;
      })
      .join("、");
  }
  return config.defaultPlotStageIds
    .map(
      (id) =>
        catalog.value?.creativePlotStages.find((stage) => stage.id === id)
          ?.title ?? t("unavailableStage")
    )
    .join("、");
});
const librarySummary = computed(() => {
  if (!configuration.value)
    return {
      materials: t("noLink"),
      skills: t("noLink")
    };
  const materialIds =
    configuration.value.workspaceType === "academic"
      ? [...new Set(configuration.value.linkedMaterialIds)]
      : [
          ...new Set(
            Object.values(configuration.value.linkedMaterialIdsByKind).flat()
          )
        ];
  const skillIds =
    configuration.value.workspaceType === "academic"
      ? [...new Set(configuration.value.linkedSkillIds)]
      : [
          ...new Set(
            Object.values(configuration.value.linkedSkillIdsByKind).flat()
          )
        ];
  const materials = materialIds.map(
    (id) =>
      catalog.value?.materials.find((item) => item.id === id)?.title ??
      t("unavailableMaterialLibrary")
  );
  const skills = skillIds.map(
    (id) =>
      catalog.value?.skills.find((item) => item.id === id)?.title ??
      t("unavailableSkillLibrary")
  );
  return {
    materials: materials.join("、") || t("noLink"),
    skills: skills.join("、") || t("noLink")
  };
});
const teamSummary = computed(
  () =>
    configuration.value?.linkedAgentTeamIds
      ?.map(
        (id) =>
          teamCatalog.value?.teams.find((team) => team.id === id)?.name ??
          t("unavailableAgentTeam")
      )
      .join("、") || t("usesTheEnabledTeam")
);
function submit() {
  if (props.submitting || loading.value) return;
  if (!selected.value || !catalog.value) {
    uiMessage.warning(t("selectATemplate"));
    return;
  }
  if (!title.value.trim()) {
    uiMessage.warning(t("enterAWorkTitle"));
    return;
  }
  const error = bookTemplateReferenceError(
    selected.value.configuration,
    catalog.value,
    teamCatalog.value
  );
  if (error) {
    uiMessage.warning(error);
    return;
  }
  const selectedConfig = selected.value.configuration;
  if (selectedConfig.workspaceType === "academic") {
    emit("submit", {
      workspaceType: "academic",
      subtype: selectedConfig.subtype,
      templateId: selected.value.id,
      title: title.value.trim(),
      ...(selectedConfig.linkedAgentTeamIds
        ? { linkedAgentTeamIds: selectedConfig.linkedAgentTeamIds }
        : {})
    });
    return;
  }
  emit("submit", {
    workspaceType: selectedConfig.workspaceType,
    genre: selectedConfig.genre,
    templateId: selected.value.id,
    title: title.value.trim(),
    ...(selectedConfig.linkedAgentTeamIds
      ? {
          linkedAgentTeamIds: selectedConfig.linkedAgentTeamIds
        }
      : {})
  });
}
</script>
<template>
  <Teleport to="body"
    ><div
      class="dialog-backdrop"
      @mousedown.self="!submitting && emit('close')"
      @keydown.esc.stop="!submitting && emit('close')"
    >
      <section
        class="workspace-dialog book-template-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-template-title"
      >
        <header>
          <h2 id="create-template-title">
            {{ t("createFromTemplate") }}
          </h2>
          <button
            class="dialog-close"
            :disabled="submitting"
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
          <p v-if="loading">
            {{ t("loadingTemplates") }}
          </p>
          <button
            v-else-if="failed"
            class="dialog-secondary-button"
            type="button"
            @click="load"
          >
            {{ t("reload") }}
          </button>
          <p v-else-if="!templates.length">
            {{ t("noTemplatesConfiguredCreateAShortStoryOrScreenplay") }}
          </p>
          <template v-else>
            <label
              >{{ t("selectTemplate")
              }}<PopupSelect
                v-model="templateId"
                :options="options"
                :accessible-label="t('selectCreationTemplate')"
                :disabled="submitting"
            /></label>
            <dl v-if="configuration" class="template-summary">
              <dt>
                {{ t("workType") }}
              </dt>
              <dd>
                {{
                  configuration.workspaceType === "academic"
                    ? academicTreeT("academicWork")
                    : configuration.workspaceType === "short"
                      ? t("shortStory")
                      : t("screenplay")
                }}
              </dd>
              <template v-if="configuration.workspaceType === 'academic'">
                <dt>{{ academicT("subtypeLabel") }}</dt>
                <dd>{{ academicSubtypeLabel(configuration.subtype) }}</dd>
                <dt>{{ academicT("citationStyleLabel") }}</dt>
                <dd>
                  {{ academicCitationStyleLabel(configuration.citationStyle) }}
                </dd>
              </template>
              <template v-else>
                <dt>{{ t("genre") }}</dt>
                <dd>{{ genreLabel(configuration.genre) }}</dd>
                <dt>
                  {{ t("characterStyle") }}
                </dt>
                <dd>
                  {{
                    configuration.characterFormat === "text"
                      ? t("textStyle")
                      : t("entryStyle")
                  }}
                </dd>
              </template>
              <dt>
                {{
                  configuration.workspaceType === "academic"
                    ? academicTreeT("zoneFramework")
                    : t("plotStages")
                }}
              </dt>
              <dd>{{ stageSummary }}</dd>
              <dt>
                {{ t("skillLibrary") }}
              </dt>
              <dd>{{ librarySummary.skills }}</dd>
              <dt>
                {{ t("materialLibrary") }}
              </dt>
              <dd>{{ librarySummary.materials }}</dd>
              <template v-if="configuration.workspaceType !== 'academic'">
                <dt>
                  {{ t("agentTeams") }}
                </dt>
                <dd>{{ teamSummary }}</dd>
              </template>
            </dl>
            <label
              >{{ t("workTitle")
              }}<input
                v-model="title"
                maxlength="80"
                :disabled="submitting"
                :placeholder="t('enterAWorkTitle')"
            /></label>
          </template>
          <div class="dialog-actions">
            <button
              type="button"
              class="dialog-secondary-button"
              :disabled="submitting"
              @click="emit('settings')"
            >
              {{ t("goToTemplateSettings") }}</button
            ><button
              type="button"
              class="dialog-secondary-button"
              :disabled="submitting"
              @click="emit('close')"
            >
              {{ t("cancel") }}</button
            ><button
              type="submit"
              class="dialog-primary-button"
              :disabled="submitting || loading || failed || !selected"
            >
              {{ submitting ? t("creating") : t("createWork") }}
            </button>
          </div>
        </form>
      </section>
    </div></Teleport
  >
</template>
<style src="./book-template.css"></style>
