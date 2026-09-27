import { expectSourceToContain } from "../../../../test-utils/sourceText";
import { describe, expect, it } from "vitest";
import pageSource from "./LongBookAnalysisPage.vue?raw";
import runControlsSource from "./LongAnalysisRunControls.vue?raw";
import runStatusSource from "./AnalysisRunStatus.vue?raw";
import planPanelSource from "./AnalysisPlanPanel.vue?raw";
import processPanelSource from "./AnalysisProcessPanel.vue?raw";
import processTrackerSource from "./analysis-process.ts?raw";
import resultPanelSource from "./AnalysisResultPanel.vue?raw";
import sourceControlsSource from "./AnalysisSourceControls.vue?raw";
import presetManagerSource from "./PresetManager.vue?raw";
import singleSelectSource from "../../components/PopupSelect.vue?raw";
import sidebarViewSource from "../../components/LeftSidebar.vue?raw";
import sidebarCatalogSource from "../../components/sidebarMoreFeatures.ts?raw";
const sidebarSource = `${sidebarViewSource}\n${sidebarCatalogSource}`;
import moduleSource from "../../components/WorkspaceFeatureModules.vue?raw";
import asyncComponentsSource from "../../components/lazyAppComponents.ts?raw";
import featureImportsSource from "../../components/lazyFeatureImports.ts?raw";
const lazySource = `${asyncComponentsSource}\n${featureImportsSource}`;

describe("long-book analysis feature wiring", () => {
  it("is a preset-driven page without a conversation composer", () => {
    expect(pageSource).toContain("长篇拆书分析");
    // The ≤50-chapter guard and the run button moved into the controls
    // component during the 1.5.6 refactor.
    // The ≤50-chapter guard stays on the page, in the controls' canStart prop.

    expect(pageSource).toContain("<PopupSelect");
    // Retry / stop live in the controls component after the 1.5.6 refactor.
    expect(runControlsSource).toContain("controller.retry");
    expect(runControlsSource).toContain("controller.stop");
    expect(pageSource).toContain("controller.selectedThinkingLevel.value");
    expect(pageSource).toContain("selectedTargetLibraryId");
    expect(pageSource).toContain("<AnalysisSourceControls");
    expect(sourceControlsSource).toContain("选择已导入长篇");
    expect(sourceControlsSource).toContain("controller.loadSavedSources");
    expect(sourceControlsSource).toContain("controller.loadSavedSource");
    expect(sourceControlsSource).toContain("备份到工作目录");
    expect(pageSource).toContain(
      ':target-library-id="controller.targetLibraryId.value"'
    );
    expect(runStatusSource).toContain("AnalysisProcessPanel");
    expect(pageSource).toContain("@show-result");
    expect(runControlsSource).toContain("执行“{{ presetName }}”预设");
    expect(pageSource).not.toContain("!selectedTargetLibraryId");
    expect(processTrackerSource).toContain("仅运行当前预设");
    expect(processPanelSource).toContain("内部思考文本不会展示");
    expect(resultPanelSource).toContain('v-model="targetId"');
    expect(resultPanelSource).toContain("生成后可随时更换目标库");
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

  it("runs the whole book as a batch plan with several presets at once", () => {
    expect(pageSource).toContain("单轮运行（≤50章）");
    expect(pageSource).toContain("整本批量");
    expect(pageSource).toContain("单轮运行（≤50章）");
    expect(pageSource).toContain(":selected-values=\"selectedPresetIds\"");
    expect(pageSource).toContain("controller.startPlan");
    expect(pageSource).toContain("开始批量计划（{{ batchTaskCount }} 个任务）");
    // Batch starts only when every chosen preset has its own target library.
    expect(pageSource).toContain("batchReady");
    expect(pageSource).toContain("setBatchLibrary");
    expect(pageSource).toContain("<AnalysisPlanPanel");
    expect(pageSource).toContain("controller.pausePlan");
    expect(pageSource).toContain(".restorePlan()");
    // The single-round path keeps its guard and wording untouched.
    expect(pageSource).toContain("selectionCount <= 50");
    expect(runControlsSource).toContain("执行“{{ presetName }}”预设");

    expect(planPanelSource).toContain("重跑此轮");
    expect(planPanelSource).toContain("controller.rerunPlanTask");
    expect(planPanelSource).toContain("controller.retryPlanWrite");
    expect(planPanelSource).toContain("跳过的轮次");
    expect(planPanelSource).toContain("已完成但未写入素材库");
    expect(planPanelSource).toContain("计划已停止");

    // 1.5.6 taught PopupSelect multi-select itself, so the page uses it with
    // `multiple` rather than a separate component.
    expect(pageSource).toContain("multiple");
    expect(singleSelectSource).toContain("aria-multiselectable");
    // The single-select popup is untouched — the multi variant is its own file.
  });

  it("keeps the page toolbar and task form responsive", () => {    expect(sourceControlsSource).toContain('class="analysis-page-actions"');
    expect(pageSource).toContain('class="chapter-range-inputs"');
    // The inline status chip became a component in the 1.5.6 refactor.
    expect(pageSource).toContain("<AnalysisRunStatus");
    expect(pageSource).toContain('import "./long-book-analysis.css"');
    expect(pageSource).toContain('class="analysis-empty-meta"');
    expect(pageSource).toContain('class="setup-field setup-range-field"');
    expect(pageSource).toContain('class="preset-target-field"');
  });

  it("configures a preset's concrete target library", () => {
    expect(presetManagerSource).toContain("默认目标：");
    expect(presetManagerSource).toContain("targetLibraryLabel");
    expect(presetManagerSource).not.toContain("导入条目类型");
    expect(presetManagerSource).toContain("cloneLongBookAnalysisPreset");
    expect(presetManagerSource).not.toContain("structuredClone(preset)");
    expect(presetManagerSource).toContain("默认预设");
    expect(presetManagerSource).toContain('v-if="!preset.builtin"');
  });
});
