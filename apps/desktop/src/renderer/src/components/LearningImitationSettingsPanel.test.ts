import { describe, expect, it } from "vitest";
import source from "./LearningImitationSettingsPanel.vue?raw";

describe("LearningImitationSettingsPanel", () => {
  it("exposes all three prompt stages and the supported runtime placeholders", () => {
    expect(source).toContain("LEARNING_IMITATION_STAGE_IDS");
    expect(source).toContain("素材拆分");
    expect(source).toContain("剧情学习");
    expect(source).toContain("文风学习");
    expect(source).toContain("DOCUMENTS_SUMMARY");
    expect(source).toContain("CURRENT_RESULT");
  });

  it("emits complete save and stage reset requests", () => {
    expect(source).toContain('emit("save"');
    expect(source).toContain('emit("reset", activeStageId.value)');
    expect(source).toContain("保存学习仿写设置");
    expect(source).toContain("恢复当前阶段默认");
  });

  it("uses floating feedback for transient validation", () => {
    expect(source).toContain('uiMessage.warning("三个学习阶段的系统提示词都不能为空")');
    expect(source).not.toContain("errorMessage");
    expect(source).not.toContain("statusMessage");
    expect(source).not.toContain("settings-error");
  });
});
