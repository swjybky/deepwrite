import { expectSourceToContain } from "../../../../test-utils/sourceText";
import { describe, expect, it } from "vitest";
import shellSource from "./LongBookAnalysisPage.vue?raw";
import setupSource from "./LongAnalysisTaskSetup.vue?raw";
import sourceSummary from "./LongAnalysisSourceSummary.vue?raw";
const pageSource = `${shellSource}\n${setupSource}\n${sourceSummary}`;
import runControlsSource from "./PresetBatchPanel.vue?raw";
import resultTabsSource from "./AnalysisResultTabs.vue?raw";
import runStatusSource from "../analysis-ui/AnalysisRunStatus.vue?raw";
import resultPanelSource from "./AnalysisResultPanel.vue?raw";
import sourceControlsSource from "./AnalysisSourceControls.vue?raw";
import presetManagerSource from "./PresetManager.vue?raw";
import presetEditorSource from "./PresetEditor.vue?raw";
import sidebarViewSource from "../../components/LeftSidebar.vue?raw";
import sidebarCatalogSource from "../../components/sidebarMoreFeatures.ts?raw";
const sidebarSource = `${sidebarViewSource}\n${sidebarCatalogSource}`;
import moduleSource from "../../components/WorkspaceFeatureModules.vue?raw";
import asyncComponentsSource from "../../components/lazyAppComponents.ts?raw";
import featureImportsSource from "../../components/lazyFeatureImports.ts?raw";
const lazySource = `${asyncComponentsSource}\n${featureImportsSource}`;

describe("long-book analysis feature wiring", () => {
  it("is a preset-driven page without a conversation composer", () => {
    expect(pageSource).toContain(
      "selectionCount <= LONG_BOOK_ANALYSIS_MAX_SELECTED_CHAPTERS"
    );
    expect(pageSource).toContain("<PopupSelect");
    expect(runControlsSource).toContain("batch.retryFailed()");
    expect(runControlsSource).toContain("batch.stop()");
    expect(setupSource).toContain(":selected-values=");
    expect(setupSource).toContain("<PresetBatchPanel");
    expect(shellSource).toContain("<AnalysisResultTabs");
    expect(resultTabsSource).toContain('role="tablist"');
    expect(resultTabsSource).toContain('"saveAll"');
    expect(pageSource).toContain("controller.selectedThinkingLevel.value");
    expect(pageSource).not.toContain("selectedTargetLibraryId");
    expect(pageSource).toContain("<AnalysisModelSettings");
    expect(setupSource).not.toContain("<AnalysisSettings");
    expect(pageSource).toContain("<AnalysisSourceControls");
    expect(sourceControlsSource).toContain("controller.loadSavedSources");
    expect(sourceControlsSource).toContain("controller.loadSavedSource");
    expect(pageSource).not.toContain(":target-library-id");
    expect(runStatusSource).toContain("<AnalysisProcessPanel");
    expect(resultPanelSource).toContain('v-model="targetId"');
    expect(pageSource).not.toContain("AgentConversation");
    expect(pageSource).not.toContain("ConversationComposer");
  });

  it("uses a lazy more-features entry with background status", () => {
    expect(sidebarSource).toContain('id: "long-book-analysis"');
    expect(sidebarSource).toContain("props.longBookAnalysisRunning");
    expectSourceToContain(
      lazySource,
      'import("../extras/long-book-analysis/loader")'
    );
    expect(moduleSource).toContain("module.kind === 'long-book-analysis'");
    expect(moduleSource).toContain('class="long-book-analysis-main-view"');
  });

  it("keeps the page toolbar and task form responsive", () => {
    expect(sourceControlsSource).toContain('class="analysis-page-actions"');
    expect(pageSource).toContain('class="chapter-range-inputs"');
    expect(runControlsSource).toContain("<AnalysisRunStatus");
    expect(pageSource).toContain('import "./long-book-analysis.css"');
    expect(pageSource).toContain('class="analysis-empty-meta"');
    expect(pageSource).toContain('class="setup-field setup-range-field"');
    expect(pageSource).not.toContain('class="preset-target-field"');
  });

  it("keeps destination selection in the completed result only", () => {
    expect(presetEditorSource).not.toContain("setTargetLibrary");
    expect(presetEditorSource).not.toContain("libraryId");
    expect(presetManagerSource).not.toContain("targetLibraryLabel");
    expect(resultPanelSource).not.toContain("props.targetLibraryId");
    expect(resultPanelSource).not.toContain("preset.output.libraryId");
    expect(presetEditorSource).not.toContain("导入条目类型");
    expect(presetManagerSource).toContain("cloneLongBookAnalysisPreset");
    expect(presetManagerSource).not.toContain("structuredClone(preset)");
    expect(presetManagerSource).toContain('v-if="!preset.builtin"');
  });
});
