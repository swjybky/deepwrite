import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../../test-utils/sourceText";
import appSource from "../WorkspaceShell.vue?raw";
import featureModulesSource from "./WorkspaceFeatureModules.vue?raw";
import featureHostCoordinatorSource from "../composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import featureHostModuleSource from "../composables/workspaceFeatureHostModule.ts?raw";
import settingsFeatureModuleSource from "../composables/settingsFeatureModule.ts?raw";
import generalPanelSource from "./GeneralSettingsPanel.vue?raw";
import fontSource from "./AppearanceFontSettings.vue?raw";
import appearancePanelSource from "./AppearanceSettingsPanel.vue?raw";
import themeSource from "./AppearanceThemeSettings.vue?raw";
import shortAgentSource from "./UnifiedShortAgentSettingsPanel.vue?raw";
import workspaceAgentFormSource from "./WorkspaceAgentProfileForm.vue?raw";
import source from "./SettingsPage.vue?raw";

const generalSettingsSource = `${source}\n${generalPanelSource}`;
const featureHostSource = `${featureHostCoordinatorSource}\n${featureHostModuleSource}\n${settingsFeatureModuleSource}`;

describe("SettingsPage", () => {
  it("can open directly on a requested settings category", () => {
    expect(source).toContain("initialCategory?: string");
    expect(source).toContain('ref(props.initialCategory ?? "general")');
  });

  it("offers a persisted auto-save switch in general settings", () => {
    expectSourceToContain(generalSettingsSource, "<strong>自动保存</strong>");
    expect(generalSettingsSource).toContain(':checked="autoSaveEnabled"');
    expectSourceToContain(generalSettingsSource, "emit('updateAutoSave'");
  });

  it("offers a persisted context usage visibility switch in general settings", () => {
    expectSourceToContain(
      generalSettingsSource,
      "<strong>上下文使用显示</strong>"
    );
    expect(generalSettingsSource).toContain(':checked="showContextUsage"');
    expect(generalSettingsSource).toContain("'updateShowContextUsage'");
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
    expectSourceToContain(generalSettingsSource, "<strong>请求批准</strong>");
    expectSourceToContain(generalSettingsSource, "<strong>替我审批</strong>");
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
    expectSourceToContain(
      generalSettingsSource,
      "<strong>跨阶段操作自动审批</strong>"
    );
    expect(generalSettingsSource).toContain(
      ':checked="autoApproveCrossStageOperations"'
    );
    expect(generalSettingsSource).toContain(
      "主智能体和子智能体的跨阶段操作将自动允许"
    );
    expect(generalSettingsSource).toContain("变更提案仍按上方审批方式处理");
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

  it("offers a persisted network proxy switch that defaults to direct access", () => {
    expectSourceToContain(generalSettingsSource, "网络设置");
    expectSourceToContain(generalSettingsSource, "<strong>网络代理</strong>");
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
    expectSourceToContain(generalSettingsSource, "<strong>页面布局</strong>");
    expect(generalSettingsSource).toContain('value: "agent-editor"');
    expect(generalSettingsSource).toContain('value: "editor-agent"');
    expect(generalSettingsSource).toContain("目录｜智能体｜文本内容");
    expect(generalSettingsSource).toContain("目录｜文本内容｜智能体");
    expect(generalSettingsSource).toContain(
      ':model-value="workspacePaneLayout"'
    );
    expectSourceToContain(
      generalSettingsSource,
      "emit('updateWorkspacePaneLayout'"
    );
  });

  it("offers a persisted default text view mode with both choices", () => {
    expectSourceToContain(
      generalSettingsSource,
      "<strong>默认文本模式</strong>"
    );
    expect(generalSettingsSource).toContain('{ value: "edit", label: "编辑" }');
    expect(generalSettingsSource).toContain(
      '{ value: "preview", label: "预览" }'
    );
    expect(generalSettingsSource).toContain(
      ':model-value="defaultTextViewMode"'
    );
    expectSourceToContain(
      generalSettingsSource,
      "emit('updateDefaultTextViewMode'"
    );
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

  it("provides a dedicated learning-imitation prompt category", () => {
    expect(source).toContain('label: "短篇学习仿写设置"');
    expect(source).toContain("<LearningImitationSettingsPanel");
    expect(source).toContain("emit('saveLearningImitation', $event)");
  });

  it("configures the default plot stages for newly created short books", () => {
    expect(workspaceAgentFormSource).toContain("剧情默认阶段配置");
    expect(workspaceAgentFormSource).toContain("下一本新建短篇");
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
    expect(source).toContain('label: "技能库配置"');
    expect(source).toContain('label: "素材库配置"');
    expect(source).toContain("<LibraryAgentSettingsPanel");
    expect(source).toContain('domain="skill"');
    expect(source).toContain('domain="material"');
    expect(source).toContain("emit('saveLibraryAgents', $event)");
    expect(source).toContain("emit('resetLibraryAgent', $event)");
  });

  it("orders usage, free, custom, old-site, and new-site model settings", () => {
    const usageIndex = source.indexOf('{ id: "usage", label: "用量"');
    const freeModelsIndex = source.indexOf(
      '{ id: "free-models", label: "免费模型"'
    );
    const customModelsIndex = source.indexOf(
      '{ id: "custom-models", label: "自定义模型配置"'
    );
    const officialModelsIndex = source.indexOf(
      '{ id: "official-models", label: "旧官方小站模型"'
    );
    const siteOfficialModelsIndex = source.indexOf(
      'id: "site-official-models"'
    );

    expect(usageIndex).toBeGreaterThan(-1);
    expect(freeModelsIndex).toBeGreaterThan(usageIndex);
    expect(customModelsIndex).toBeGreaterThan(freeModelsIndex);
    expect(officialModelsIndex).toBeGreaterThan(customModelsIndex);
    expect(siteOfficialModelsIndex).toBeGreaterThan(officialModelsIndex);
    expect(source).toContain('model-scope="custom"');
    expect(source).toContain('emit("loadModels")');
    expect(source).toContain("emit('saveModels', $event)");
    expect(source).toContain("emit('testModel', $event)");
    expect(source).toContain("<FreeModelsPanel");
    expect(source).toContain("emit('refreshFreeModels')");
    expect(source).toContain("emit('setFreeModelEnabled'");
    expect(source).toContain(':testing-model-id="testingModelId"');
    expect(source).toContain("@test=\"emit('testModel', $event)\"");
    expect(source).toContain("<OfficialModelsPanel");
    expect(source).toContain("emit('saveOfficialToken', $event)");
    expect(source).toContain('if (id === "official-models")');
    expect(source).toContain('emit("loadOfficialModels")');
    expect(source).toContain('if (id === "site-official-models")');
    expect(source).toContain("<SiteOfficialModelsPanel");
    expect(source).toContain('label: "新官方小站模型"');
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
    expect(fontSource).toContain("<strong>界面字体</strong>");
    expect(fontSource).toContain("<strong>正文字体</strong>");
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
    expect(fontSource).toContain("上传字体");
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
