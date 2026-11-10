<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, nextTick, ref } from "vue";
import {
  isDeepWriteSiteOfficialModel,
  isJevModel,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput
} from "@deepwrite/contracts";
import { useModelProviderGroups } from "../composables/useModelProviderGroups";
import { useModelSettingsDraft } from "../composables/useModelSettingsDraft";
import {
  builtinProviderSets,
  collectUserProviderIds
} from "../utils/customModelProvider";
import AppIcon from "./AppIcon.vue";
import ModelAdvancedConfigDialog from "./ModelAdvancedConfigDialog.vue";
import ModelAnnouncementNotice from "./ModelAnnouncementNotice.vue";
import JevModelEditorPanel from "./JevModelEditorPanel.vue";
import ModelEditorPanel from "./ModelEditorPanel.vue";
import { MODEL_PROVIDER_OPTIONS } from "./modelProviderPresets";
import { thinkingLabel } from "./modelSettingsDraft";

const t = createScopedTranslator("components.modelSettingsFeature");

const props = withDefaults(
  defineProps<{
    active?: boolean;
    modelScope?: "all" | "custom";
    embedded?: boolean;
    modelSettings: ModelSettings | null;
    modelLoading: boolean;
    modelSaving: boolean;
    modelError: string | null;
    modelTestMessage: string | null;
    testingModelId: string | null;
    modelAlertMessages: readonly string[];
  }>(),
  {
    active: false,
    modelScope: "all",
    embedded: false
  }
);

const emit = defineEmits<{
  saveModels: [settings: ModelSettingsInput];
  testModel: [model: ModelConfigInput];
  openOfficialModels: [];
}>();

const modelConfigScrollArea = ref<HTMLElement | null>(null);
function scrollModelEditorIntoView(): void {
  void nextTick(() => {
    modelConfigScrollArea.value
      ?.querySelector<HTMLElement>(".model-editor")
      ?.scrollIntoView({ block: "nearest", behavior: "auto" });
  });
}

const {
  draftModels,
  draftDefaultModelId,
  pendingDefaultModelId,
  modelEditor,
  advancedConfigModel,
  modelConfigRows,
  createModel,
  editModel,
  saveModelEditor,
  testDraftModel,
  removeModel,
  openAdvancedConfig,
  closeAdvancedConfig,
  saveAdvancedConfig,
  setDefaultModel
} = useModelSettingsDraft(props, {
  saveModels: (settings) => emit("saveModels", settings),
  testModel: (model) => emit("testModel", model),
  editorOpened: scrollModelEditorIntoView
});
const { modelProviderGroups, expandedProviders, toggleProvider } =
  useModelProviderGroups(modelConfigRows);
const knownUserProviders = computed(() =>
  collectUserProviderIds(
    draftModels.value
      .filter((model) => !model.managedBy)
      .map((model) => model.provider),
    builtinProviderSets(MODEL_PROVIDER_OPTIONS).values
  )
);
</script>

<template>
  <section
    class="workspace-settings-panel is-model-config"
    :class="{
      'is-embedded': embedded,
      'is-setting-default': modelSaving && pendingDefaultModelId !== null
    }"
  >
    <header v-if="!embedded">
      <div>
        <span class="dialog-eyebrow">DeepWrite</span>
        <h2>{{ t("customModelSettings") }}</h2>
      </div>
    </header>

    <div class="dialog-content model-config-content">
      <div ref="modelConfigScrollArea" class="model-config-scroll-area">
        <ModelAnnouncementNotice
          v-if="!embedded"
          :messages="modelAlertMessages"
          @open-official-models="emit('openOfficialModels')"
        />

        <div v-if="modelLoading && !modelSettings" class="dialog-note">
          {{ t("readingModelSettings") }}
        </div>
        <template v-else>
          <div class="model-list-toolbar">
            <span class="model-list-summary"
              >{{
                t("providersMessage", {
                  arg0: modelProviderGroups.length ?? ""
                })
              }}<span class="model-list-dot">·</span
              >{{
                t("modelsMessage", {
                  arg0: draftModels.length ?? ""
                })
              }}<span class="model-list-dot">·</span
              >{{ t("modelPurposeHint") }}</span
            >
            <div class="model-list-actions">
              <button
                class="model-list-add"
                type="button"
                :disabled="modelSaving || Boolean(modelEditor)"
                @click="createModel('llm')"
              >
                <AppIcon name="plus" :size="14" />{{ t("addModel") }}
              </button>
              <button
                class="model-list-add"
                type="button"
                :disabled="modelSaving || Boolean(modelEditor)"
                @click="createModel('jev')"
              >
                <AppIcon name="plus" :size="14" />{{ t("addJevModel") }}
              </button>
            </div>
          </div>
          <div v-if="draftModels.length === 0" class="model-empty-state">
            <strong>{{
              modelScope === "custom"
                ? t("noCustomModelsConfigured")
                : t("noLiveModelsConfigured")
            }}</strong>
            <span>{{
              modelScope === "custom"
                ? t("afterAddingACustomModelTestItsConnectionManage")
                : t("thisConversationStillUsesDeepWriteFauxAddAModel")
            }}</span>
          </div>

          <section
            v-for="group in modelProviderGroups"
            :key="group.key"
            class="model-provider-group"
            :class="{ 'is-expanded': expandedProviders.has(group.key) }"
          >
            <button
              class="model-provider-heading"
              type="button"
              :aria-expanded="expandedProviders.has(group.key)"
              @click="toggleProvider(group.key)"
            >
              <span class="model-provider-icon" aria-hidden="true"
                ><AppIcon name="model" :size="16"
              /></span>
              <strong>{{ group.label }}</strong>
              <span class="model-provider-count">{{
                t("modelsMessage", {
                  arg0: group.count ?? ""
                })
              }}</span>
              <AppIcon
                name="chevron"
                :size="14"
                :class="{ 'is-expanded': expandedProviders.has(group.key) }"
              />
            </button>
            <div
              v-show="expandedProviders.has(group.key)"
              class="model-provider-content"
            >
              <template v-for="row in group.rows" :key="row.key">
                <JevModelEditorPanel
                  v-if="
                    row.type === 'editor' &&
                    modelEditor &&
                    isJevModel(modelEditor)
                  "
                  :model="modelEditor"
                  :editing="Boolean(modelEditor.originalId)"
                  :saving="modelSaving"
                  :testing-model-id="testingModelId"
                  @cancel="modelEditor = null"
                  @save="saveModelEditor"
                  @test="emit('testModel', $event)"
                />
                <ModelEditorPanel
                  v-else-if="row.type === 'editor' && modelEditor"
                  :model="modelEditor"
                  :editing="Boolean(modelEditor.originalId)"
                  :saving="modelSaving"
                  :testing-model-id="testingModelId"
                  :known-user-providers="knownUserProviders"
                  @cancel="modelEditor = null"
                  @save="saveModelEditor"
                  @test="emit('testModel', $event)"
                />

                <article
                  v-else-if="row.type === 'model'"
                  class="model-card model-config-card"
                  :class="{
                    'is-default': draftDefaultModelId === row.model.id
                  }"
                >
                  <div class="model-config-details">
                    <strong
                      >{{ row.model.label
                      }}<span class="model-kind-badge">{{
                        isJevModel(row.model) ? t("jevModel") : t("llmModel")
                      }}</span></strong
                    >
                    <small>
                      {{
                        isDeepWriteSiteOfficialModel(row.model)
                          ? t("officialSiteModels")
                          : row.model.managedBy === "deepwrite-free"
                            ? t("deepWriteFreeModels")
                            : row.model.provider
                      }}
                      · {{ row.model.modelId }}
                      <template v-if="!isJevModel(row.model)"
                        >· {{ row.model.api }}</template
                      >
                    </small>
                    <small>
                      <template v-if="!isJevModel(row.model)"
                        >{{
                          row.model.reasoning
                            ? t("reasoningValue", {
                                arg0: thinkingLabel(
                                  row.model.defaultThinkingLevel
                                )
                              })
                            : t("temperatureValue", {
                                arg0: row.model.temperatureOptions.join(" / ")
                              })
                        }}
                        ·
                      </template>
                      {{
                        row.model.hasApiKey || row.model.apiKey
                          ? t("keyConfigured")
                          : row.model.managedBy
                            ? t("managedAccess")
                            : t("noKeyConfigured")
                      }}
                    </small>
                  </div>
                  <div class="model-card-actions">
                    <button
                      v-if="!isJevModel(row.model)"
                      class="model-default-action"
                      type="button"
                      :class="{
                        'is-active': draftDefaultModelId === row.model.id
                      }"
                      :disabled="modelSaving || Boolean(modelEditor)"
                      :aria-busy="
                        modelSaving && pendingDefaultModelId === row.model.id
                      "
                      @click="setDefaultModel(row.model.id)"
                    >
                      <span
                        v-for="label in [
                          t('saving'),
                          t('default'),
                          t('setAsDefault')
                        ]"
                        :key="label"
                        class="model-default-label-sizer"
                        aria-hidden="true"
                        >{{ label }}</span
                      >
                      <span>{{
                        modelSaving && pendingDefaultModelId === row.model.id
                          ? t("saving")
                          : draftDefaultModelId === row.model.id
                            ? t("default")
                            : t("setAsDefault")
                      }}</span>
                    </button>
                    <button
                      v-if="!row.model.managedBy"
                      type="button"
                      :disabled="modelSaving"
                      @click="editModel(row.model)"
                    >
                      {{ t("edit") }}
                    </button>
                    <button
                      type="button"
                      :disabled="testingModelId !== null"
                      :title="t('testTheCurrentUnsavedSettings')"
                      @click="testDraftModel(row.model)"
                    >
                      {{
                        testingModelId === row.model.id
                          ? t("testing")
                          : t("testConnection")
                      }}
                    </button>
                    <button
                      v-if="!row.model.managedBy && !isJevModel(row.model)"
                      type="button"
                      :disabled="modelSaving || Boolean(modelEditor)"
                      :title="t('configureContextLengthAndMaximumOutputLength')"
                      @click="openAdvancedConfig(row.model)"
                    >
                      {{ t("advancedSettings") }}
                    </button>
                    <button
                      v-if="!row.model.managedBy"
                      class="is-danger"
                      type="button"
                      :disabled="modelSaving || Boolean(modelEditor)"
                      @click="removeModel(row.model.id)"
                    >
                      {{ t("delete") }}
                    </button>
                  </div>
                </article>
              </template>
            </div>
          </section>

          <JevModelEditorPanel
            v-if="
              modelEditor && !modelEditor.originalId && isJevModel(modelEditor)
            "
            :key="modelEditor.id"
            :model="modelEditor"
            :editing="false"
            :saving="modelSaving"
            :testing-model-id="testingModelId"
            @cancel="modelEditor = null"
            @save="saveModelEditor"
            @test="emit('testModel', $event)"
          />
          <ModelEditorPanel
            v-else-if="modelEditor && !modelEditor.originalId"
            :key="modelEditor.id"
            :model="modelEditor"
            :editing="false"
            :saving="modelSaving"
            :testing-model-id="testingModelId"
            :known-user-providers="knownUserProviders"
            @cancel="modelEditor = null"
            @save="saveModelEditor"
            @test="emit('testModel', $event)"
          />
        </template>
      </div>
    </div>
  </section>

  <ModelAdvancedConfigDialog
    :model="advancedConfigModel"
    :busy="modelSaving"
    @close="closeAdvancedConfig"
    @save="saveAdvancedConfig"
  />
</template>

<style scoped src="../styles/model-settings-feature.css"></style>
