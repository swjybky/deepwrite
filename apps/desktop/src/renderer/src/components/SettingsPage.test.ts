import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import appSource from "../WorkspaceShell.vue?raw";
import featureModulesSource from "./WorkspaceFeatureModules.vue?raw";
import featureHostCoordinatorSource from "../composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import featureHostModuleSource from "../composables/workspaceFeatureHostModule.ts?raw";
import settingsFeatureModuleSource from "../composables/settingsFeatureModule.ts?raw";
import bodyTextSource from "./BodyTextSettingsPanel.vue?raw";
import configurationPanelSource from "./ConfigurationSettingsPanel.vue?raw";
import generalPanelSource from "./GeneralSettingsPanel.vue?raw";
import fontSource from "./AppearanceFontSettings.vue?raw";
import appearancePanelSource from "./AppearanceSettingsPanel.vue?raw";
import themeSource from "./AppearanceThemeSettings.vue?raw";
import shortAgentSource from "./UnifiedShortAgentSettingsPanel.vue?raw";
import workspaceAgentFormSource from "./WorkspaceAgentProfileForm.vue?raw";
import settingsPageSource from "./SettingsPage.vue?raw";
import settingsCategoriesSource from "./settingsCategories.ts?raw";

const source = `${settingsPageSource}\n${settingsCategoriesSource}`;

const generalSettingsSource = `${source}\n${generalPanelSource}`;
const featureHostSource = `${featureHostCoordinatorSource}\n${featureHostModuleSource}\n${settingsFeatureModuleSource}`;

describe("SettingsPage", () => {
  it("can open directly on a requested settings category", () => {
    expect(source).toContain("initialCategory?: string");
    expect(source).toContain('ref(props.initialCategory ?? "general")');
  });

  it("keeps storage in workspace-directory settings and shares the existing coordinator", () => {
    expect(source).toContain("<StorageSettingsPanel");
    expect(source).not.toContain("WorkspaceDirectoryFeature");
    expect(source).toContain('return t("storage");');
    expect(source).toContain(
      ':workspace-directory-path="workspaceDirectoryPath"'
    );
    expect(source).toContain(
      "@choose-workspace-directory=\"emit('chooseWorkspaceDirectory')\""
    );
    expect(source).toContain(
      "@reset-workspace-directory=\"emit('resetWorkspaceDirectory')\""
    );
    expect(featureModulesSource).toContain(
      "@reset-workspace-directory=\"emit('resetWorkspaceDirectory')\""
    );
    const settingsHost = appSource.slice(
      appSource.indexOf("v-if=\"workspaceFeatureModule?.kind === 'settings'\""),
      appSource.indexOf("<div\n    v-else")
    );
    expect(settingsHost).toContain(
      '@choose-workspace-directory="featureHost.chooseWorkspaceDirectory"'
    );
    expect(settingsHost).toContain(
      '@reset-workspace-directory="featureHost.resetWorkspaceDirectory"'
    );
  });

  it("offers a persisted auto-save switch in general settings", () => {
    expectSourceToContain(generalSettingsSource, "autoSave");
    expect(generalSettingsSource).toContain(':checked="autoSaveEnabled"');
    expectSourceToContain(generalSettingsSource, "emit('updateAutoSave'");
  });

  it("groups persisted context controls on the configuration page", () => {
    expect(source).toContain("activeCategory === 'configuration'");
    expect(source).toContain("<ConfigurationSettingsPanel");
    expect(configurationPanelSource).toContain("contextSettings");
    expectSourceToContain(configurationPanelSource, "showContextUsage");
    expect(configurationPanelSource).toContain(':checked="showContextUsage"');
    expect(configurationPanelSource).toContain("'updateShowContextUsage'");
    expect(configurationPanelSource).toContain(
      "<ContextCompactionSettingsCard"
    );
    expect(configurationPanelSource).toContain("'updateContextCompaction'");
    expect(generalPanelSource).not.toContain("上下文使用显示");
    expect(generalPanelSource).not.toContain("ContextCompactionSettingsCard");
    expect(source).toContain(':show-context-usage="showContextUsage"');
    expect(featureModulesSource).toContain(
      ':show-context-usage="module.showContextUsage"'
    );
    expect(featureHostSource).toContain(
      "settingsStore.generalSettings.showContextUsage"
    );
    expect(appSource).toContain(
      '@update-show-context-usage="updateShowContextUsage"'
    );
  });

  it("keeps only the requested general controls and makes permission modes exclusive", () => {
    expect(generalSettingsSource).toContain('role="radiogroup"');
    expect(generalSettingsSource).toContain('type="radio"');
    expect(generalSettingsSource).toContain(
      "permissionMode === 'request-approval'"
    );
    expect(generalSettingsSource).toContain(
      "permissionMode === 'auto-approve'"
    );
    expectSourceToContain(generalSettingsSource, "requestApproval");
    expectSourceToContain(generalSettingsSource, "autoApproval");
    expect(generalSettingsSource).not.toContain(
      "permissionMode === 'full-access'"
    );
    expect(generalSettingsSource).not.toContain(
      "<strong>完全访问权限</strong>"
    );
    expect(generalSettingsSource).toContain("emit('updatePermissionMode'");
    expect(generalSettingsSource).not.toContain(
      "<strong>默认文件打开目标</strong>"
    );
  });

  it("offers an independent persisted cross-stage auto-approval switch", () => {
    expectSourceToContain(generalSettingsSource, "crossStageApproval");
    expect(generalSettingsSource).toContain(
      ':checked="autoApproveCrossStageOperations"'
    );
    expect(generalSettingsSource).toContain("crossStageApprovalDescription");
    expect(generalSettingsSource).toContain("crossStageApprovalDescription");
    expect(generalSettingsSource).toContain(
      "'updateAutoApproveCrossStageOperations'"
    );
  });

  it("wires language and menu-bar controls to persisted settings", () => {
    expect(generalSettingsSource).toContain(':model-value="language"');
    expect(generalSettingsSource).toContain("emit('updateLanguage'");
    expect(generalSettingsSource).toContain(':checked="showInMenuBar"');
    expectSourceToContain(generalSettingsSource, "emit('updateShowInMenuBar'");
  });

  it("offers a persisted task notification switch next to the menu-bar one", () => {
    expect(generalSettingsSource).toContain(':checked="taskNotification"');
    expectSourceToContain(generalSettingsSource, "'updateTaskNotification'");
    expect(generalSettingsSource).toContain('t("taskNotificationDescription")');
  });

  it("offers a persisted network proxy switch that defaults to direct access", () => {
    expectSourceToContain(generalSettingsSource, "network");
    expectSourceToContain(generalSettingsSource, "proxy");
    expect(generalSettingsSource).toContain(':checked="useNetworkProxy"');
    expect(generalSettingsSource).toContain("'updateUseNetworkProxy'");
    expect(source).toContain(':use-network-proxy="useNetworkProxy"');
    expect(featureModulesSource).toContain(
      ':use-network-proxy="module.useNetworkProxy"'
    );
    expect(featureHostSource).toContain(
      "settingsStore.generalSettings.useNetworkProxy"
    );
    expect(appSource).toContain(
      '@update-use-network-proxy="updateUseNetworkProxy"'
    );
  });

  it("offers both persisted creative-workspace pane layouts", () => {
    expectSourceToContain(generalSettingsSource, "layout");
    expect(generalSettingsSource).toContain('value: "agent-editor"');
    expect(generalSettingsSource).toContain('value: "editor-agent"');
    expect(generalSettingsSource).toContain("agentFirst");
    expect(generalSettingsSource).toContain("agentFirst");
    expect(generalSettingsSource).toContain(
      ':model-value="workspacePaneLayout"'
    );
    expectSourceToContain(
      generalSettingsSource,
      "emit('updateWorkspacePaneLayout'"
    );
  });

  it("offers a persisted default text view mode with both choices", () => {
    expect(generalPanelSource).not.toContain("默认文本模式");
    expectSourceToContain(bodyTextSource, "defaultTextMode");
    expect(bodyTextSource).toContain("edit");
    expect(bodyTextSource).toContain("preview");
    expect(bodyTextSource).toContain(':model-value="defaultTextViewMode"');
    expectSourceToContain(bodyTextSource, "emit('updateDefaultTextViewMode'");
    expect(featureModulesSource).toContain(
      ':default-text-view-mode="module.defaultTextViewMode"'
    );
    expect(featureHostSource).toContain(
      "settingsStore.generalSettings.defaultTextViewMode"
    );
    expect(appSource).toContain(
      '@update-default-text-view-mode="updateDefaultTextViewMode"'
    );
  });

  it("keeps the language selector from squeezing its label column", () => {
    expect(generalSettingsSource).toContain(
      'class="settings-item settings-select-item"'
    );
    expect(generalPanelSource).toContain(
      '<style scoped src="./settings-page.css">'
    );
    expectSourceToContain(
      generalPanelSource,
      ".settings-select-item { flex-wrap: wrap; }"
    );
    expect(generalPanelSource).toContain("flex: 0 1 210px;");
  });

  it("no longer exposes the retired learning-imitation category", () => {
    expect(source).not.toContain("短篇学习仿写设置");
    expect(source).not.toContain("LearningImitation");
  });

  it("configures the default plot stages for newly created short books", () => {
    expect(workspaceAgentFormSource).toContain("defaultPlotStages");
    expect(workspaceAgentFormSource).toContain(
      "choosePlotStagesToCreateAndEnableForThe"
    );
    expect(shortAgentSource).toContain("props.plotStages.map");
    expect(shortAgentSource).toContain("selectedDefaultPlotStageIds");
    expect(shortAgentSource).toContain("defaultPlotStageIds");
    expect(featureModulesSource).toContain(
      ':creative-plot-stages="module.creativePlotStages"'
    );
  });

  it("keeps agent-team management outside the settings page", () => {
    expect(source).not.toContain('id: "agent-teams"');
    expect(source).not.toContain("<AgentTeamSettingsPanel");
    expect(source).not.toContain("saveAgentTeams");
  });

  it("provides dedicated skill and material library agent categories", () => {
    expect(source).toContain("skillLibrarySettings");
    expect(source).toContain("materialLibrarySettings");
    expect(source).toContain("<LibraryAgentSettingsPanel");
    expect(source).toContain('domain="skill"');
    expect(source).toContain('domain="material"');
    expect(source).toContain("emit('saveLibraryAgents', $event)");
    expect(source).toContain("emit('resetLibraryAgent', $event)");
  });

  it("offers usage, free, custom, and new official-site model settings", () => {
    const usageIndex = source.indexOf('id: "usage"');
    const freeModelsIndex = source.indexOf('id: "free-models"');
    const customModelsIndex = source.indexOf('id: "custom-models"');
    const siteOfficialModelsIndex = source.indexOf(
      'id: "site-official-models"'
    );

    expect(usageIndex).toBeGreaterThan(-1);
    expect(freeModelsIndex).toBeGreaterThan(usageIndex);
    expect(customModelsIndex).toBeGreaterThan(freeModelsIndex);
    expect(siteOfficialModelsIndex).toBeGreaterThan(customModelsIndex);
    expect(source).not.toContain('id: "official-models"');
    expect(source).not.toContain("<OfficialModelsPanel");
    expect(source).toContain('model-scope="custom"');
    expect(source).toContain('emit("loadModels")');
    expect(source).toContain("emit('saveModels', $event)");
    expect(source).toContain("emit('testModel', $event)");
    expect(source).toContain("<FreeModelsPanel");
    expect(source).toContain("emit('refreshFreeModels')");
    expect(source).toContain("emit('setFreeModelEnabled'");
    expect(source).toContain(':testing-model-id="testingModelId"');
    expect(source).toContain("@test=\"emit('testModel', $event)\"");
    expect(source).toContain('if (id === "site-official-models")');
    expect(source).toContain("<SiteOfficialModelsPanel");
    expect(source).toContain("officialSiteModels");
    expect(source).toContain("emit('saveSiteOfficialToken', $event)");
    expect(source).toContain("emit('clearSiteOfficialToken')");
    expect(source).toContain('emit("loadSiteOfficialModels")');
    expect(source).toContain("emit('refreshSiteOfficialModels')");
    expect(source).toContain("emit('setSiteOfficialModelEnabled'");
    expect(source).toContain(':quota="siteOfficialQuota"');
  });

  it("connects custom model management to the existing app model state and actions", () => {
    expect(featureHostSource).toContain(
      "modelLoading: settingsStore.modelLoading"
    );
    expect(featureHostSource).toContain(
      "modelSaving: settingsStore.modelSaving"
    );
    expect(featureModulesSource).toContain(
      ':model-loading="module.modelLoading"'
    );
    expect(featureModulesSource).toContain(
      ':model-saving="module.modelSaving"'
    );
    expect(featureModulesSource).toContain(
      ':free-models-refreshing="module.freeModelsRefreshing"'
    );
    expect(featureModulesSource).toContain(
      ':site-official-quota="module.siteOfficialQuota"'
    );
    expect(featureModulesSource).toContain(
      "@load-models=\"emit('loadModels')\""
    );
    expect(appSource).toContain('@load-models="loadModelSettings"');
    expect(appSource).toContain('@save-models="saveModelSettings"');
    expect(appSource).toContain('@test-model="testModel"');
    expect(appSource).toContain('@refresh-free-models="refreshFreeModels"');
    expect(appSource).toContain(
      '@refresh-site-official-models="refreshSiteOfficialModels"'
    );
    expect(appSource).toContain(
      '@set-free-model-enabled="setFreeModelEnabled"'
    );
  });

  it("lets users pick UI and editor font families from appearance settings", () => {
    expect(source).toContain("<AppearanceSettingsPanel");
    expect(fontSource).toContain("interfaceFont");
    expect(fontSource).toContain("manuscriptFont");
    expect(fontSource).toContain("appearance.setUiFontFamily");
    expect(fontSource).toContain("appearance.setEditorFontFamily");
    expect(fontSource).toContain(':model-value="uiFontModelValue"');
    expect(fontSource).toContain(':model-value="editorFontModelValue"');
    expect(fontSource).toContain("UI_FONT_LOADING_VALUE");
    expect(fontSource).toContain("EDITOR_FONT_LOADING_VALUE");
    expect(fontSource).toContain("++uiFontSelectionIntent");
    expect(fontSource).toContain("++editorFontSelectionIntent");
    expect(fontSource).toContain("listAppearanceUiFontFamilyOptions");
    expect(fontSource).toContain("listAppearanceEditorFontFamilyOptions");
    expect(fontSource).toContain('@option-action="requestDelete"');
    expect(fontSource).toContain("uploadFont");
    expect(appearancePanelSource).toContain("appearance.whenReady()");
    expect(appearancePanelSource).toContain(':disabled="!ready"');
  });

  it("lets users replace a font-size value and previews valid input immediately", () => {
    expect(themeSource).toContain(
      "@input=\"previewFontSize('uiFontSize', $event)\""
    );
    expect(themeSource).toContain(
      "@change=\"commitFontSize('uiFontSize', $event)\""
    );
    expect(themeSource).not.toContain("restoreEmptyFontSize");
  });

  it("previews valid typed colors and validates incomplete values on commit", () => {
    expect(themeSource).toContain(
      "@input=\"previewColor('background', $event)\""
    );
    expect(themeSource).toContain(
      "@change=\"commitColor('background', $event)\""
    );
    expect(themeSource).toContain('preset: "custom"');
    expect(themeSource).toContain("editingTheme.accent.toLowerCase()");
    expect(themeSource).toContain("editingTheme.background.toLowerCase()");
    expect(themeSource).toContain("editingTheme.foreground.toLowerCase()");
    expect(themeSource).toContain("openColorPicker(");
    expect(themeSource).not.toContain(
      'appearance.updateTheme(editingScheme.value, { preset: "custom" })'
    );
  });
});
