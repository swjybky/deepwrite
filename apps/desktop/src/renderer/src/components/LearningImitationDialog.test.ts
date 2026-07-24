import { describe, expect, it } from "vitest";
import source from "./LearningImitationDialog.vue?raw";

describe("LearningImitationDialog", () => {
  it("keeps the full three-stage workflow and an editable result preview", () => {
    expect(source).toContain("一键拆素材");
    expect(source).toContain("一键学习剧情设计");
    expect(source).toContain("一键文风学习");
    expect(source).toContain("result.material_split[field.id]");
    expect(source).toContain("result.plot_learning.plotDesignSkill");
    expect(source).toContain("result.plot_learning.plotRefineSkill");
    expect(source).toContain("result.style_learning.body");
    expect(source).toContain('accessible-label="选择学习仿写模型"');
    expect(source).toContain('import PopupSelect');
    expect(source).not.toContain("<select");
  });

  it("does not show result dots beside stage labels", () => {
    expect(source).not.toContain('aria-label="已有结果"');
    expect(source).not.toContain(".learning-tabs button > i");
  });

  it("uploads full-text TXT, Markdown, PDF and Word documents through the learning reader", () => {
    expect(source).toContain('from "../utils/learningDocumentFiles"');
    expect(source).toContain("await readLearningDocumentFile(file)");
    expect(source).toContain(":accept=\"LEARNING_DOCUMENT_ACCEPT\"");
    expect(source).toContain("LEARNING_DOCUMENT_SUPPORTED_LABEL");
    expect(source).toContain("LEARNING_IMITATION_MAX_DOCUMENTS");
  });

  it("persists previews to selected material and skill libraries with both modes", () => {
    expect(source).toContain("selectedMaterialLibraryIds");
    expect(source).toContain("selectedSkillLibraryIds");
    expect(source).toContain("window.deepwrite.catalog.saveLibraryEntry");
    expect(source).toContain("window.deepwrite.catalog.createLibraryEntry");
    expect(source).toContain("persistStage('append')");
    expect(source).toContain("persistStage('overwrite')");
    expect(source).toContain('emit("refreshCatalog")');
  });

  it("can explicitly create missing target libraries in a fresh workspace", () => {
    expect(source).toContain("CREATE_LIBRARY_VALUE");
    expect(source).toContain("＋ 新建资料库…");
    expect(source).toContain("newMaterialLibraryNames[kind]");
    expect(source).toContain("newSkillLibraryNames[kind]");
    expect(source).toContain("api.catalog.createLibrary");
    expect(source).toContain('domain: "material"');
    expect(source).toContain("materialKind: kind");
    expect(source).toContain('domain: "skill"');
    expect(source).toContain("skillKind: kind");
    expect(source).toContain('v-for="kind in LEARNING_MATERIAL_KINDS"');
  });

  it("auto-overwrites once after a hidden run completes, otherwise only preserves preview", () => {
    expect(source).toContain("props.controller.lastCompletedRunId.value");
    expect(source).toContain("props.controller.lastCompletedStage.value");
    expect(source).toContain("!props.open");
    expect(source).toContain("backgroundPersistRunIds.has(runId)");
    expect(source).toContain('persistStage("overwrite", stageId, true)');
    expect(source).toContain(
      "后台完成，预览已保留；重新打开后选择目标确认落盘。"
    );
  });

  it("only hides on close and explicitly explains that the controller keeps running", () => {
    const closeFunction = source.slice(
      source.indexOf("function requestClose"),
      source.indexOf("function openFilePicker")
    );
    expect(closeFunction).toContain('emit("close")');
    expect(closeFunction).not.toContain("controller.stop");
    expect(closeFunction).not.toContain("controller.dispose");
    expect(source).toContain("关闭弹窗；运行中的任务会在后台继续");
    expect(source).toContain("再次打开会继续显示同一轮进度");
  });

  it("uses the standard neutral primary action for creating a new learning session", () => {
    expect(source).toContain('class="learning-primary-button is-confirm"');
    expect(source).not.toContain("learning-primary-button is-danger");
    expect(source).toContain("background: var(--neutral-solid)");
  });

  it("uses the same neutral primary action for confirming persistence", () => {
    const persistAction = source.slice(
      source.indexOf('{{ saving ? "落盘中…" : "确认落盘" }}') - 240,
      source.indexOf('{{ saving ? "落盘中…" : "确认落盘" }}') + 80
    );
    expect(persistAction).toContain('class="learning-primary-button is-confirm"');
  });

  it("routes temporary feedback through uiMessage and points prompt editing to settings", () => {
    expect(source).toContain('import { uiMessage } from "../ui-feedback"');
    expect(source).toContain("uiMessage.warning");
    expect(source).toContain("uiMessage.error");
    expect(source).toContain("设置 → 学习仿写设置");
    expect(source).not.toContain("learning-status--error");
  });
});
