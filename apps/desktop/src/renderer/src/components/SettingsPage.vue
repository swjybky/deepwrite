<script setup lang="ts">
import { computed, ref } from "vue";
import {
  type AppLanguage,
  type BodyTextFormats,
  type BodyTextFormatChange,
  type CreativePlotStage,
  type GeneralPermissionMode,
  type LearningImitationSettings,
  type LearningImitationSettingsInput,
  type LearningImitationStageId,
  type LibraryAgentDomain,
  type LibraryAgentSettings,
  type LibraryAgentSettingsInput,
  type LongAgentSettings,
  type LongAgentSettingsInput,
  type ModelConfigInput,
  type ModelSettings,
  type ModelSettingsInput,
  type ModelUsageDashboard,
  type ModelUsageQueryInput,
  type OfficialModelBalance,
  type SiteOfficialQuota,
  type TextViewMode,
  type WorkspacePaneLayout,
  type WorkspaceAgentSettings,
  type WorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import WorkspaceDirectoryFeature from "./WorkspaceDirectoryFeature.vue";
import AppearanceSettingsPanel from "./AppearanceSettingsPanel.vue";
import FreeModelsPanel from "./FreeModelsPanel.vue";
import BodyTextSettingsPanel from "./BodyTextSettingsPanel.vue";
import GeneralSettingsPanel from "./GeneralSettingsPanel.vue";
import LearningImitationSettingsPanel from "./LearningImitationSettingsPanel.vue";
import LibraryAgentSettingsPanel from "./LibraryAgentSettingsPanel.vue";
import ModelSettingsFeature from "./ModelSettingsFeature.vue";
import ModelUsagePanel from "./ModelUsagePanel.vue";
import OfficialModelsPanel from "./OfficialModelsPanel.vue";
import ShortAgentSettingsPanel from "./ShortAgentSettingsPanel.vue";
import SiteOfficialModelsPanel from "./SiteOfficialModelsPanel.vue";

interface SettingsCategory {
  id: string;
  label: string;
  icon?:
    | "directory"
    | "user"
    | "sparkles"
    | "keyboard"
    | "globe"
    | "model"
    | "ledger"
    | "brain"
    | "settings"
    | "wand"
    | "archive";
}

interface SettingsSection {
  id: string;
  label: string;
  categories: SettingsCategory[];
}

const props = defineProps<{
  initialCategory?: string;
  workspaceDirectoryPath: string | null;
  workspaceDirectoryLoading: boolean;
  permissionMode: GeneralPermissionMode;
  autoApproveCrossStageOperations: boolean;
  autoSaveEnabled: boolean;
  language: AppLanguage;
  showContextUsage: boolean;
  autoCompactContext: boolean;
  autoCompactThresholdPercent: number;
  showInMenuBar: boolean;
  useNetworkProxy: boolean;
  workspacePaneLayout: WorkspacePaneLayout;
  defaultTextViewMode: TextViewMode;
  bodyTextFormats: BodyTextFormats;
  workspaceAgentSettings: readonly WorkspaceAgentSettings[];
  creativePlotStages: readonly CreativePlotStage[];
  longAgentSettings: LongAgentSettings | null;
  workspaceAgentLoading: boolean;
  workspaceAgentSaving: boolean;
  longAgentLoading: boolean;
  longAgentSaving: boolean;
  longAgentError: string | null;
  learningImitationSettings: LearningImitationSettings | null;
  learningImitationLoading: boolean;
  learningImitationSaving: boolean;
  modelUsageDashboard: ModelUsageDashboard | null;
  modelUsageLoading: boolean;
  modelSettings: ModelSettings | null;
  modelLoading: boolean;
  modelSaving: boolean;
  freeModelsRefreshing: boolean;
  freeModelsSaving: boolean;
  siteOfficialModelsRefreshing: boolean;
  siteOfficialModelsSaving: boolean;
  siteOfficialQuota: SiteOfficialQuota | null;
  modelError: string | null;
  modelTestMessage: string | null;
  testingModelId: string | null;
  officialModelUsageDashboard: ModelUsageDashboard | null;
  officialModelBalance: OfficialModelBalance | null;
  officialModelsLoading: boolean;
  officialModelsSaving: boolean;
  libraryAgentSettings: LibraryAgentSettings | null;
  libraryAgentLoading: boolean;
  libraryAgentSaving: boolean;
  runtimeAvailable: boolean;
}>();

const emit = defineEmits<{
  back: [];
  chooseWorkspaceDirectory: [];
  updatePermissionMode: [mode: GeneralPermissionMode];
  updateAutoApproveCrossStageOperations: [enabled: boolean];
  updateAutoSave: [enabled: boolean];
  updateLanguage: [language: AppLanguage];
  updateShowContextUsage: [enabled: boolean];
  updateAutoCompactContext: [enabled: boolean];
  updateAutoCompactThresholdPercent: [percent: number];
  updateShowInMenuBar: [enabled: boolean];
  updateUseNetworkProxy: [enabled: boolean];
  updateWorkspacePaneLayout: [layout: WorkspacePaneLayout];
  updateDefaultTextViewMode: [mode: TextViewMode];
  updateBodyTextFormat: [change: BodyTextFormatChange];
  saveWorkspaceAgents: [settings: WorkspaceAgentSettingsInput];
  retryLongAgents: [];
  saveLongAgents: [settings: LongAgentSettingsInput];
  saveLearningImitation: [settings: LearningImitationSettingsInput];
  resetLearningImitation: [stageId: LearningImitationStageId];
  saveLibraryAgents: [settings: LibraryAgentSettingsInput];
  resetLibraryAgent: [domain: LibraryAgentDomain];
  loadModelUsage: [input?: ModelUsageQueryInput];
  loadModels: [];
  saveModels: [settings: ModelSettingsInput];
  testModel: [model: ModelConfigInput];
  loadOfficialModels: [];
  loadSiteOfficialModels: [];
  saveOfficialToken: [apiKey: string];
  clearOfficialToken: [];
  saveSiteOfficialToken: [apiKey: string];
  clearSiteOfficialToken: [];
  refreshSiteOfficialModels: [];
  setSiteOfficialModelEnabled: [modelId: string, enabled: boolean];
  setOfficialModelEnabled: [modelId: string, enabled: boolean];
  refreshFreeModels: [];
  setFreeModelEnabled: [modelId: string, enabled: boolean];
}>();
const activeCategory = ref(props.initialCategory ?? "general");
const searchQuery = ref("");

const sections: SettingsSection[] = [
  {
    id: "creation",
    label: "创作",
    categories: [
      { id: "directory", label: "工作目录", icon: "directory" },
      { id: "short-agents", label: "创作空间配置", icon: "brain" },
      { id: "skill-library-agent", label: "技能库配置", icon: "wand" },
      { id: "material-library-agent", label: "素材库配置", icon: "archive" },
      { id: "learning-imitation", label: "短篇学习仿写设置", icon: "sparkles" }
    ]
  },
  {
    id: "models-and-usage",
    label: "模型与用量",
    categories: [
      { id: "usage", label: "用量", icon: "ledger" },
      { id: "free-models", label: "免费模型", icon: "model" },
      { id: "custom-models", label: "自定义模型配置", icon: "model" },
      { id: "official-models", label: "旧官方小站模型", icon: "model" },
      {
        id: "site-official-models",
        label: "新官方小站模型",
        icon: "model"
      }
    ]
  },
  {
    id: "personal",
    label: "个人",
    categories: [
      { id: "general", label: "常规", icon: "settings" },
      { id: "body-text", label: "正文文本", icon: "wand" },
      { id: "profile", label: "个人资料", icon: "user" },
      { id: "appearance", label: "外观", icon: "sparkles" },
      { id: "voice", label: "语音", icon: "brain" },
      { id: "configuration", label: "配置", icon: "model" },
      { id: "personalization", label: "个性化", icon: "sparkles" },
      { id: "keyboard", label: "键盘快捷键", icon: "keyboard" }
    ]
  }
];

const visibleSections = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return sections;
  return sections
    .map((section) => ({
      ...section,
      categories: section.categories.filter((category) =>
        category.label.toLocaleLowerCase().includes(query)
      )
    }))
    .filter((section) => section.categories.length);
});

const activeLabel = computed(() => {
  for (const section of sections) {
    const found = section.categories.find(
      (category) => category.id === activeCategory.value
    );
    if (found) return found.label;
  }
  return "常规";
});

async function selectCategory(id: string): Promise<void> {
  if (id === "official-models") {
    emit("loadOfficialModels");
  }
  if (id === "custom-models") {
    emit("loadModels");
  }
  if (id === "site-official-models") {
    emit("loadSiteOfficialModels");
  }
  activeCategory.value = id;
}
</script>

<template>
  <div class="settings-page">
    <aside class="settings-sidebar">
      <button class="settings-back" type="button" @click="emit('back')">
        <AppIcon name="chevron" :size="14" />
        <span>返回应用</span>
      </button>

      <div class="settings-search">
        <AppIcon name="search" :size="14" />
        <input v-model="searchQuery" type="search" placeholder="搜索设置..." />
      </div>

      <nav class="settings-nav" aria-label="设置分类">
        <div
          v-for="section in visibleSections"
          :key="section.id"
          class="settings-section"
        >
          <strong class="settings-section-label">{{ section.label }}</strong>
          <button
            v-for="category in section.categories"
            :key="category.id"
            class="settings-category"
            :class="{ 'is-active': activeCategory === category.id }"
            type="button"
            @click="selectCategory(category.id)"
          >
            <AppIcon v-if="category.icon" :name="category.icon" :size="15" />
            <span v-else class="settings-category-spacer" />
            <span>{{ category.label }}</span>
          </button>
        </div>
        <p v-if="!visibleSections.length" class="settings-search-empty">
          没有匹配的设置
        </p>
      </nav>
    </aside>

    <main class="settings-content">
      <div class="settings-content-inner">
        <h1 class="settings-title">{{ activeLabel }}</h1>

        <WorkspaceDirectoryFeature
          v-if="activeCategory === 'directory'"
          embedded
          :path="workspaceDirectoryPath"
          :loading="workspaceDirectoryLoading"
          :runtime-available="runtimeAvailable"
          @choose="emit('chooseWorkspaceDirectory')"
        />

        <ShortAgentSettingsPanel
          v-else-if="activeCategory === 'short-agents'"
          :settings="workspaceAgentSettings"
          :creative-plot-stages="creativePlotStages"
          :long-settings="longAgentSettings"
          :loading="workspaceAgentLoading"
          :saving="workspaceAgentSaving"
          :long-loading="longAgentLoading"
          :long-saving="longAgentSaving"
          :long-error-message="longAgentError"
          :runtime-available="runtimeAvailable"
          @save="emit('saveWorkspaceAgents', $event)"
          @retry-long="emit('retryLongAgents')"
          @save-long="emit('saveLongAgents', $event)"
        />

        <LearningImitationSettingsPanel
          v-else-if="activeCategory === 'learning-imitation'"
          :settings="learningImitationSettings"
          :loading="learningImitationLoading"
          :saving="learningImitationSaving"
          :runtime-available="runtimeAvailable"
          @save="emit('saveLearningImitation', $event)"
          @reset="emit('resetLearningImitation', $event)"
        />

        <LibraryAgentSettingsPanel
          v-else-if="activeCategory === 'skill-library-agent'"
          domain="skill"
          :settings="libraryAgentSettings"
          :loading="libraryAgentLoading"
          :saving="libraryAgentSaving"
          :runtime-available="runtimeAvailable"
          @save="emit('saveLibraryAgents', $event)"
          @reset="emit('resetLibraryAgent', $event)"
        />

        <LibraryAgentSettingsPanel
          v-else-if="activeCategory === 'material-library-agent'"
          domain="material"
          :settings="libraryAgentSettings"
          :loading="libraryAgentLoading"
          :saving="libraryAgentSaving"
          :runtime-available="runtimeAvailable"
          @save="emit('saveLibraryAgents', $event)"
          @reset="emit('resetLibraryAgent', $event)"
        />

        <ModelUsagePanel
          v-else-if="activeCategory === 'usage'"
          :dashboard="modelUsageDashboard"
          :loading="modelUsageLoading"
          @query="emit('loadModelUsage', $event)"
        />

        <FreeModelsPanel
          v-else-if="activeCategory === 'free-models'"
          :settings="modelSettings"
          :refreshing="freeModelsRefreshing"
          :saving="freeModelsSaving"
          :testing-model-id="testingModelId"
          @refresh="emit('refreshFreeModels')"
          @test="emit('testModel', $event)"
          @set-model-enabled="
            emit('setFreeModelEnabled', $event.modelId, $event.enabled)
          "
        />

        <ModelSettingsFeature
          v-else-if="activeCategory === 'custom-models'"
          model-scope="custom"
          embedded
          active
          :model-settings="modelSettings"
          :model-loading="modelLoading"
          :model-saving="modelSaving"
          :model-error="modelError"
          :model-test-message="modelTestMessage"
          :testing-model-id="testingModelId"
          :model-alert-messages="[]"
          @save-models="emit('saveModels', $event)"
          @test-model="emit('testModel', $event)"
        />

        <OfficialModelsPanel
          v-else-if="activeCategory === 'official-models'"
          :settings="modelSettings"
          :dashboard="officialModelUsageDashboard"
          :balance="officialModelBalance"
          :loading="officialModelsLoading"
          :saving="officialModelsSaving"
          @load="emit('loadOfficialModels')"
          @save-token="emit('saveOfficialToken', $event)"
          @clear-token="emit('clearOfficialToken')"
          @set-model-enabled="
            emit('setOfficialModelEnabled', $event.modelId, $event.enabled)
          "
        />

        <SiteOfficialModelsPanel
          v-else-if="activeCategory === 'site-official-models'"
          :settings="modelSettings"
          :saving="siteOfficialModelsSaving"
          :refreshing="siteOfficialModelsRefreshing"
          :quota="siteOfficialQuota"
          :testing-model-id="testingModelId"
          @test="emit('testModel', $event)"
          @save-token="emit('saveSiteOfficialToken', $event)"
          @clear-token="emit('clearSiteOfficialToken')"
          @refresh="emit('refreshSiteOfficialModels')"
          @set-model-enabled="
            emit('setSiteOfficialModelEnabled', $event.modelId, $event.enabled)
          "
        />

        <GeneralSettingsPanel
          v-else-if="activeCategory === 'general'"
          :permission-mode="permissionMode"
          :auto-approve-cross-stage-operations="autoApproveCrossStageOperations"
          :auto-save-enabled="autoSaveEnabled"
          :language="language"
          :show-context-usage="showContextUsage"
          :auto-compact-context="autoCompactContext"
          :auto-compact-threshold-percent="autoCompactThresholdPercent"
          :show-in-menu-bar="showInMenuBar"
          :use-network-proxy="useNetworkProxy"
          :workspace-pane-layout="workspacePaneLayout"
          @update-permission-mode="emit('updatePermissionMode', $event)"
          @update-auto-approve-cross-stage-operations="
            emit('updateAutoApproveCrossStageOperations', $event)
          "
          @update-auto-save="emit('updateAutoSave', $event)"
          @update-language="emit('updateLanguage', $event)"
          @update-show-context-usage="emit('updateShowContextUsage', $event)"
          @update-auto-compact-context="emit('updateAutoCompactContext', $event)"
          @update-auto-compact-threshold-percent="
            emit('updateAutoCompactThresholdPercent', $event)
          "
          @update-show-in-menu-bar="emit('updateShowInMenuBar', $event)"
          @update-use-network-proxy="emit('updateUseNetworkProxy', $event)"
          @update-workspace-pane-layout="
            emit('updateWorkspacePaneLayout', $event)
          "
        />

        <BodyTextSettingsPanel
          v-else-if="activeCategory === 'body-text'"
          :default-text-view-mode="defaultTextViewMode"
          :body-text-formats="bodyTextFormats"
          @update-default-text-view-mode="
            emit('updateDefaultTextViewMode', $event)
          "
          @update-body-text-format="emit('updateBodyTextFormat', $event)"
        />

        <AppearanceSettingsPanel v-else-if="activeCategory === 'appearance'" />

        <section v-else class="settings-group">
          <div class="settings-card">
            <p class="settings-placeholder">
              「{{ activeLabel }}」设置项待配置。
            </p>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped src="./settings-page.css"></style>
