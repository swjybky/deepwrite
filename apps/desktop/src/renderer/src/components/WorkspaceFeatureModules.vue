<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type {
  AgentTeamCatalogSnapshot,
  AgentTeamProfileCreateInput,
  AgentTeamProfileRenameInput,
  AgentTeamProfileSaveInput,
  AgentTeamProfileSetEnabledInput,
  AgentTeamProfileTargetInput,
  AppLanguage,
  ContextCompactionSettings,
  BodyTextFormatChange,
  GeneralPermissionMode,
  LibraryAgentDomain,
  LibraryAgentSettingsInput,
  LongAgentSettingsInput,
  MarketplaceSession,
  ModelConfigInput,
  ModelSettingsInput,
  ModelUsageQueryInput,
  MoreFeaturesSettings,
  TextViewMode,
  WorkspacePaneLayout,
  WorkspaceAgentSettingsInput
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import {
  BookIdentityPage,
  AgentTeamSettingsPanel,
  CloudBackupPage,
  DeviceSyncPage,
  LongBookAnalysisPage,
  LongBookDecompositionPage,
  LongMaterialPackPage,
  ShortBookAnalysisPage,
  RevisionAnalysisPage,
  StyleComparisonPage,
  SettingsPage,
  SkillMarketplacePage,
  AgentTeamMarketplacePage,
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

const t = createScopedTranslator("components.workspaceFeatureModules");
const identityT = createScopedTranslator("extras.bookIdentity");
const decompositionT = createScopedTranslator("extras.longBookDecomposition");
const packT = createScopedTranslator("extras.longMaterialPack");

defineProps<{
  module: WorkspaceFeatureModule;
  leftCollapsed: boolean;
}>();

const emit = defineEmits<{
  openIdentityBook: [
    book: import("@deepwrite/contracts").ChatAssistantProjectRef
  ];
  openImageSettings: [];
  createIdentityBook: [];
  openDecompositionRef: [
    ref: import("@deepwrite/contracts").DecompositionContentRef
  ];
  openDecompositionTarget: [
    target: import("@deepwrite/contracts").DecompositionTarget
  ];
  openMaterialGroup: [groupId: string];
  openMaterialEntry: [entry: { libraryId: string; entryId: string }];
  openLongBook: [bookId: string];
  openMaterialPack: [bookId: string];
  expandLeft: [];
  back: [];
  updatePermissionMode: [mode: GeneralPermissionMode];
  updateAutoApproveCrossStageOperations: [enabled: boolean];
  updateAutoSave: [enabled: boolean];
  updateLanguage: [language: AppLanguage];
  updateShowContextUsage: [enabled: boolean];
  updateTextAttachmentMaxCharacters: [value: number];
  updateContextCompaction: [settings: ContextCompactionSettings];
  updateShowInMenuBar: [enabled: boolean];
  updateUseNetworkProxy: [enabled: boolean];
  updateWorkspacePaneLayout: [layout: WorkspacePaneLayout];
  updateDefaultTextViewMode: [mode: TextViewMode];
  updateBodyTextFormat: [change: BodyTextFormatChange];
  updateMoreFeatures: [settings: MoreFeaturesSettings];
  saveWorkspaceAgents: [settings: WorkspaceAgentSettingsInput];
  retryLongAgents: [];
  saveLongAgents: [settings: LongAgentSettingsInput];
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
  resetWorkspaceDirectory: [];
  refreshFreeModels: [];
  openOfficialModels: [];
  refreshCatalog: [];
  marketplaceSessionChange: [session: MarketplaceSession];
  agentTeamCatalogChange: [catalog: AgentTeamCatalogSnapshot];
}>();
</script>

<template>
  <SettingsPage
    v-if="module.kind === 'settings'"
    :initial-category="module.initialCategory"
    :workspace-directory-path="module.workspaceDirectoryPath"
    :workspace-directory-loading="module.workspaceDirectoryLoading"
    @choose-workspace-directory="emit('chooseWorkspaceDirectory')"
    @reset-workspace-directory="emit('resetWorkspaceDirectory')"
    :permission-mode="module.permissionMode"
    :auto-approve-cross-stage-operations="
      module.autoApproveCrossStageOperations
    "
    :auto-save-enabled="module.autoSaveEnabled"
    :language="module.language"
    :show-context-usage="module.showContextUsage"
    :text-attachment-max-characters="module.textAttachmentMaxCharacters"
    :context-compaction="module.contextCompaction"
    :show-in-menu-bar="module.showInMenuBar"
    :use-network-proxy="module.useNetworkProxy"
    :workspace-pane-layout="module.workspacePaneLayout"
    :default-text-view-mode="module.defaultTextViewMode"
    :body-text-formats="module.bodyTextFormats"
    :more-features-settings="module.moreFeaturesSettings"
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
    @update-text-attachment-max-characters="
      emit('updateTextAttachmentMaxCharacters', $event)
    "
    @update-context-compaction="emit('updateContextCompaction', $event)"
    @update-show-in-menu-bar="emit('updateShowInMenuBar', $event)"
    @update-use-network-proxy="emit('updateUseNetworkProxy', $event)"
    @update-workspace-pane-layout="emit('updateWorkspacePaneLayout', $event)"
    @update-default-text-view-mode="emit('updateDefaultTextViewMode', $event)"
    @update-body-text-format="emit('updateBodyTextFormat', $event)"
    @update-more-features="emit('updateMoreFeatures', $event)"
    @save-workspace-agents="emit('saveWorkspaceAgents', $event)"
    @retry-long-agents="emit('retryLongAgents')"
    @save-long-agents="emit('saveLongAgents', $event)"
    @save-library-agents="emit('saveLibraryAgents', $event)"
    @reset-library-agent="emit('resetLibraryAgent', $event)"
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
    :label="t('agentTeams')"
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
    :label="t('workspaceFolder')"
    @expand-left="emit('expandLeft')"
  >
    <WorkspaceDirectoryFeature
      :path="module.path"
      :loading="module.loading"
      @choose="emit('chooseWorkspaceDirectory')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'revision-analysis'"
    class="long-book-analysis-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="long-book-analysis-expand-sidebar"
    :label="t('revisionAnalysis')"
    @expand-left="emit('expandLeft')"
  >
    <RevisionAnalysisPage
      v-if="module.controller"
      :controller="module.controller"
      :models="module.models"
      :catalog-snapshot="module.catalogSnapshot"
      @refresh-catalog="emit('refreshCatalog')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'short-book-analysis'"
    class="long-book-analysis-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="long-book-analysis-expand-sidebar"
    :label="t('shortStoryAnalysis')"
    @expand-left="emit('expandLeft')"
  >
    <ShortBookAnalysisPage
      v-if="module.controller"
      :controller="module.controller"
      :models="module.models"
      :catalog-snapshot="module.catalogSnapshot"
      @refresh-catalog="emit('refreshCatalog')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'long-book-analysis'"
    class="long-book-analysis-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="long-book-analysis-expand-sidebar"
    :label="t('novelAnalysis')"
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

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'book-identity'"
    class="long-book-analysis-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="long-book-analysis-expand-sidebar"
    :label="identityT('title')"
    @expand-left="emit('expandLeft')"
  >
    <BookIdentityPage
      :models="module.models"
      :preferred-model-id="module.preferredModelId"
      @open-book="emit('openIdentityBook', $event)"
      @open-settings="emit('openImageSettings')"
      @create="emit('createIdentityBook')"
      @refresh-catalog="emit('refreshCatalog')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'long-material-pack'"
    class="long-book-analysis-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="long-book-analysis-expand-sidebar"
    :label="packT('title')"
    @expand-left="emit('expandLeft')"
  >
    <LongMaterialPackPage
      :models="module.models"
      :preferred-model-id="module.preferredModelId"
      @open-group="emit('openMaterialGroup', $event)"
      @open-entry="emit('openMaterialEntry', $event)"
      @open-long-book="emit('openLongBook', $event)"
      @refresh-catalog="emit('refreshCatalog')"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'style-comparison'"
    class="style-comparison-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="marketplace-expand-sidebar"
    :label="t('styleComparison')"
    @expand-left="emit('expandLeft')"
  >
    <StyleComparisonPage
      :models="module.models"
      :preferred-model-id="module.preferredModelId"
    />
  </WorkspaceFeatureFrame>

  <WorkspaceFeatureFrame
    v-else-if="module.kind === 'long-book-decomposition'"
    class="long-book-analysis-main-view"
    :left-collapsed="leftCollapsed"
    expand-button-class="long-book-analysis-expand-sidebar"
    :label="decompositionT('title')"
    @expand-left="emit('expandLeft')"
  >
    <LongBookDecompositionPage
      v-if="module.controller"
      :controller="module.controller"
      :models="module.models"
      :catalog-snapshot="module.catalogSnapshot"
      @refresh-catalog="emit('refreshCatalog')"
      @open="emit('openDecompositionRef', $event)"
      @open-target="emit('openDecompositionTarget', $event)"
      @open-material-pack="emit('openMaterialPack', $event)"
    />
  </WorkspaceFeatureFrame>

  <main
    v-else-if="module.kind === 'marketplace'"
    class="marketplace-main-view"
    :aria-label="t('skillMarketplace')"
  >
    <button
      v-if="leftCollapsed"
      class="icon-button marketplace-expand-sidebar"
      type="button"
      :aria-label="t('expandSidebar')"
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
    v-else-if="module.kind === 'agent-team-marketplace'"
    class="marketplace-main-view"
    :aria-label="t('agentTeamMarketplace')"
  >
    <button
      v-if="leftCollapsed"
      class="icon-button marketplace-expand-sidebar"
      type="button"
      :aria-label="t('expandSidebar')"
      @click="emit('expandLeft')"
    >
      <AppIcon name="panel-left" :size="18" />
    </button>
    <AgentTeamMarketplacePage
      :catalog="module.catalog"
      :initial-session="module.session"
      @session-change="emit('marketplaceSessionChange', $event)"
      @catalog-change="emit('agentTeamCatalogChange', $event)"
    />
  </main>

  <main
    v-else-if="module.kind === 'device-sync'"
    class="marketplace-main-view"
    :aria-label="t('deviceSync')"
  >
    <button
      v-if="leftCollapsed"
      class="pane-toggle-button"
      :aria-label="t('expandSidebarLabel')"
      @click="emit('expandLeft')"
    >
      <AppIcon name="panel-left" :size="18" />
    </button>
    <DeviceSyncPage
      :prepare-sync="module.prepareSync"
      :refresh-sync="module.refreshSync"
      @refresh-catalog="emit('refreshCatalog')"
    />
  </main>

  <main
    v-else-if="module.kind === 'cloud-backup'"
    class="marketplace-main-view"
    :aria-label="t('cloudBackup')"
  >
    <button
      v-if="leftCollapsed"
      class="icon-button marketplace-expand-sidebar"
      type="button"
      :aria-label="t('expandSidebar')"
      @click="emit('expandLeft')"
    >
      <AppIcon name="panel-left" :size="18" />
    </button>
    <CloudBackupPage active @refresh-catalog="emit('refreshCatalog')" />
  </main>

  <main
    v-else-if="module.kind === 'zhuque-detection'"
    class="zhuque-detection-main-view"
    :aria-label="t('aITextDetection')"
  >
    <button
      v-if="leftCollapsed"
      class="icon-button zhuque-detection-expand-sidebar"
      type="button"
      :aria-label="t('expandSidebar')"
      @click="emit('expandLeft')"
    >
      <AppIcon name="panel-left" :size="18" />
    </button>
    <ZhuqueDetectionPage />
  </main>
</template>
