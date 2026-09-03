<script setup lang="ts">
import type {
  AgentTeamProfileCreateInput,
  AgentTeamProfileRenameInput,
  AgentTeamProfileSaveInput,
  AgentTeamProfileSetEnabledInput,
  AgentTeamProfileTargetInput,
  AppLanguage,
  GeneralPermissionMode,
  LearningImitationSettingsInput,
  LearningImitationStageId,
  LibraryAgentDomain,
  LibraryAgentSettingsInput,
  LongAgentSettingsInput,
  MarketplaceSession,
  ModelConfigInput,
  ModelSettingsInput,
  ModelUsageQueryInput,
  TextViewMode,
  WorkspacePaneLayout,
  WorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import {
  AgentTeamSettingsPanel,
  CloudBackupPage,
  LearningImitationDialog,
  LongBookAnalysisPage,
  ModelSettingsFeature,
  SettingsPage,
  SkillMarketplacePage,
  ZhuqueDetectionPage,
  WorkspaceDirectoryFeature
} from "./lazyAppComponents";
import type { WorkspaceFeatureModule } from "./WorkspaceFeatureModules.types";
import WorkspaceFeatureFrame from "./WorkspaceFeatureFrame.vue";
import {
  generateWorkspaceFeatureSubagent,
  resetWorkspaceFeatureSubagent,
  stopWorkspaceFeatureSubagent
} from "./workspaceFeatureModuleAuthoring";

defineProps<{
  module: WorkspaceFeatureModule;
  leftCollapsed: boolean;
}>();

const emit = defineEmits<{
  expandLeft: [];
  back: [];
  updatePermissionMode: [mode: GeneralPermissionMode];
  updateAutoApproveCrossStageOperations: [enabled: boolean];
  updateAutoSave: [enabled: boolean];
  updateLanguage: [language: AppLanguage];
  updateShowContextUsage: [enabled: boolean];
  updateShowInMenuBar: [enabled: boolean];
  updateUseNetworkProxy: [enabled: boolean];
  updateWorkspacePaneLayout: [layout: WorkspacePaneLayout];
  updateDefaultTextViewMode: [mode: TextViewMode];
  saveWorkspaceAgents: [settings: WorkspaceAgentSettingsInput];
  retryLongAgents: [];
  saveLongAgents: [settings: LongAgentSettingsInput];
  saveLibraryAgents: [settings: LibraryAgentSettingsInput];
  resetLibraryAgent: [domain: LibraryAgentDomain];
  saveLearningImitation: [settings: LearningImitationSettingsInput];
  resetLearningImitation: [stageId: LearningImitationStageId];
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
  setFreeModelEnabled: [modelId: string, enabled: boolean];
  retryAgentTeam: [];
  createAgentTeam: [input: AgentTeamProfileCreateInput];
  renameAgentTeam: [input: AgentTeamProfileRenameInput];
  deleteAgentTeam: [input: AgentTeamProfileTargetInput];
  downloadAgentTeam: [input: AgentTeamProfileTargetInput];
  installAgentTeam: [];
  setAgentTeamEnabled: [input: AgentTeamProfileSetEnabledInput];
  saveAgentTeam: [input: AgentTeamProfileSaveInput];
  chooseWorkspaceDirectory: [];
  refreshFreeModels: [];
  openOfficialModels: [];
  refreshCatalog: [];
  marketplaceSessionChange: [session: MarketplaceSession];
}>();
</script>

<template>
  <SettingsPage
    v-if="module.kind === 'settings'"
    :initial-category="module.initialCategory"
    :permission-mode="module.permissionMode"
    :auto-approve-cross-stage-operations="
      module.autoApproveCrossStageOperations
    "
    :auto-save-enabled="module.autoSaveEnabled"
    :language="module.language"
    :show-context-usage="module.showContextUsage"
    :show-in-menu-bar="module.showInMenuBar"
    :use-network-proxy="module.useNetworkProxy"
    :workspace-pane-layout="module.workspacePaneLayout"
    :default-text-view-mode="module.defaultTextViewMode"
    :workspace-agent-settings="module.workspaceAgentSettings"
    :creative-plot-stages="module.creativePlotStages"
    :long-agent-settings="module.longAgentSettings"
    :workspace-agent-loading="module.workspaceAgentLoading"
    :workspace-agent-saving="module.workspaceAgentSaving"
    :long-agent-loading="module.longAgentLoading"
    :long-agent-saving="module.longAgentSaving"
    :long-agent-error="module.longAgentError"
    :library-agent-settings="module.libraryAgentSettings"
    :library-agent-loading="module.libraryAgentLoading"
    :library-agent-saving="module.libraryAgentSaving"
    :learning-imitation-settings="module.learningImitationSettings"
    :learning-imitation-loading="module.learningImitationLoading"
    :learning-imitation-saving="module.learningImitationSaving"
    :model-usage-dashboard="module.modelUsageDashboard"
    :model-usage-loading="module.modelUsageLoading"
    :model-settings="module.modelSettings"
    :model-loading="module.modelLoading"
    :model-saving="module.modelSaving"
    :free-models-refreshing="module.freeModelsRefreshing"
    :free-models-saving="module.freeModelsSaving"
    :site-official-models-refreshing="module.siteOfficialModelsRefreshing"
    :site-official-models-saving="module.siteOfficialModelsSaving"
    :site-official-quota="module.siteOfficialQuota"
    :model-error="module.modelError"
    :model-test-message="module.modelTestMessage"
    :testing-model-id="module.testingModelId"
    :official-model-usage-dashboard="module.officialModelUsageDashboard"
    :official-model-balance="module.officialModelBalance"
    :official-models-loading="module.officialModelsLoading"
    :official-models-saving="module.officialModelsSaving"
    :runtime-available="module.runtimeAvailable"
    @back="emit('back')"
    @update-permission-mode="emit('updatePermissionMode', $event)"
    @update-auto-approve-cross-stage-operations="
      emit('updateAutoApproveCrossStageOperations', $event)
    "
    @update-auto-save="emit('updateAutoSave', $event)"
    @update-language="emit('updateLanguage', $event)"
    @update-show-context-usage="emit('updateShowContextUsage', $event)"
    @update-show-in-menu-bar="emit('updateShowInMenuBar', $event)"
    @update-use-network-proxy="emit('updateUseNetworkProxy', $event)"
    @update-workspace-pane-layout="emit('updateWorkspacePaneLayout', $event)"
    @update-default-text-view-mode="emit('updateDefaultTextViewMode', $event)"
    @save-workspace-agents="emit('saveWorkspaceAgents', $event)"
    @retry-long-agents="emit('retryLongAgents')"
    @save-long-agents="emit('saveLongAgents', $event)"
    @save-library-agents="emit('saveLibraryAgents', $event)"
    @reset-library-agent="emit('resetLibraryAgent', $event)"
    @save-learning-imitation="emit('saveLearningImitation', $event)"
    @reset-learning-imitation="emit('resetLearningImitation', $event)"
    @load-model-usage="emit('loadModelUsage', $event)"
    @load-models="emit('loadModels')"
    @save-models="emit('saveModels', $event)"
    @test-model="emit('testModel', $event)"
    @load-official-models="emit('loadOfficialModels')"
    @load-site-official-models="emit('loadSiteOfficialModels')"
    @save-official-token="emit('saveOfficialToken', $event)"
    @clear-official-token="emit('clearOfficialToken')"
    @save-site-official-token="emit('saveSiteOfficialToken', $event)"
    @clear-site-official-token="emit('clearSiteOfficialToken')"
    @refresh-site-official-models="emit('refreshSiteOfficialModels')"
    @set-site-official-model-enabled="
      (modelId, enabled) =>
        emit('setSiteOfficialModelEnabled', modelId, enabled)
    "
    @set-official-model-enabled="
      (modelId, enabled) => emit('setOfficialModelEnabled', modelId, enabled)
    "
    @refresh-free-models="emit('refreshFreeModels')"
    @set-free-model-enabled="
      (modelId, enabled) => emit('setFreeModelEnabled', modelId, enabled)
    "
  />

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'agent-team'"
    class="agent-team-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="agent-team-expand-sidebar"
    label="智能体团队"
    @expand-left="emit('expandLeft')"
  >
    <AgentTeamSettingsPanel
      v-if="module.authoring"
      :catalog="module.catalog"
      :navigation-epoch="module.navigationEpoch"
      :models="module.models"
      :skills="module.skills"
      :preferred-model-id="module.preferredModelId"
      :loading="module.loading"
      :saving="module.saving"
      :load-error="module.loadError"
      :runtime-available="module.runtimeAvailable"
      :authoring-generating="module.authoring.isBusy.value"
      :authoring-draft="module.authoring.draft.value"
      :authoring-status-text="module.authoring.statusText.value"
      :authoring-error="module.authoring.error.value"
      @retry="emit('retryAgentTeam')"
      @create="emit('createAgentTeam', $event)"
      @rename="emit('renameAgentTeam', $event)"
      @delete="emit('deleteAgentTeam', $event)"
      @download="emit('downloadAgentTeam', $event)"
      @install="emit('installAgentTeam')"
      @set-enabled="emit('setAgentTeamEnabled', $event)"
      @save="emit('saveAgentTeam', $event)"
      @authoring-generate="generateWorkspaceFeatureSubagent(module, $event)"
      @authoring-stop="stopWorkspaceFeatureSubagent(module)"
      @authoring-reset="resetWorkspaceFeatureSubagent(module)"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'directory'"
    class="workspace-settings-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="workspace-settings-expand-sidebar"
    label="工作目录"
    @expand-left="emit('expandLeft')"
  >
    <WorkspaceDirectoryFeature
      :path="module.path"
      :loading="module.loading"
      @choose="emit('chooseWorkspaceDirectory')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'models'"
    class="workspace-settings-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="workspace-settings-expand-sidebar"
    label="模型配置"
    @expand-left="emit('expandLeft')"
  >
    <ModelSettingsFeature
      active
      :model-settings="module.settings"
      :model-loading="module.loading"
      :model-saving="module.saving"
      :model-error="module.error"
      :model-test-message="module.testMessage"
      :testing-model-id="module.testingModelId"
      :model-alert-messages="module.alertMessages"
      @save-models="emit('saveModels', $event)"
      @test-model="emit('testModel', $event)"
      @open-official-models="emit('openOfficialModels')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'imitation'"
    class="learning-imitation-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="learning-imitation-expand-sidebar"
    label="短篇学习仿写"
    @expand-left="emit('expandLeft')"
  >
    <LearningImitationDialog
      v-if="module.controller"
      active
      :controller="module.controller"
      :models="module.models"
      :catalog-snapshot="module.catalogSnapshot"
      :approval-mode="module.approvalMode"
      @refresh-catalog="emit('refreshCatalog')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'long-book-analysis'"
    class="long-book-analysis-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="long-book-analysis-expand-sidebar"
    label="长篇拆书分析"
    @expand-left="emit('expandLeft')"
  >
    <LongBookAnalysisPage
      v-if="module.controller"
      :controller="module.controller"
      :models="module.models"
      :catalog-snapshot="module.catalogSnapshot"
      @refresh-catalog="emit('refreshCatalog')"
    />
  </WorkspaceFeatureFrame>

  <main
    v-else-if="module.kind === 'marketplace'"
    class="marketplace-main-view"
    aria-label="技能广场"
  >
    <button
      v-if="leftCollapsed"
      class="icon-button marketplace-expand-sidebar"
      type="button"
      aria-label="展开左侧栏"
      @click="emit('expandLeft')"
    >
      <AppIcon name="panel-left" :size="18" />
    </button>
    <SkillMarketplacePage
      active
      :catalog-snapshot="module.catalogSnapshot"
      :initial-session="module.session"
      @refresh-catalog="emit('refreshCatalog')"
      @session-change="emit('marketplaceSessionChange', $event)"
    />
  </main>

  <main
    v-else-if="module.kind === 'cloud-backup'"
    class="marketplace-main-view"
    aria-label="云端备份"
  >
    <button
      v-if="leftCollapsed"
      class="icon-button marketplace-expand-sidebar"
      type="button"
      aria-label="展开左侧栏"
      @click="emit('expandLeft')"
    >
      <AppIcon name="panel-left" :size="18" />
    </button>
    <CloudBackupPage active @refresh-catalog="emit('refreshCatalog')" />
  </main>

  <main
    v-else-if="module.kind === 'zhuque-detection'"
    class="zhuque-detection-main-view"
    aria-label="朱雀检测"
  >
    <button
      v-if="leftCollapsed"
      class="icon-button zhuque-detection-expand-sidebar"
      type="button"
      aria-label="展开左侧栏"
      @click="emit('expandLeft')"
    >
      <AppIcon name="panel-left" :size="18" />
    </button>
    <ZhuqueDetectionPage />
  </main>
</template>
