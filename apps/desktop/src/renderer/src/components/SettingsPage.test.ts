import { describe, expect, it } from "vitest";
import source from "./SettingsPage.vue?raw";

describe("SettingsPage", () => {
  it("offers a persisted auto-save switch in general settings", () => {
    expect(source).toContain("<strong>自动保存</strong>");
    expect(source).toContain(':checked="autoSaveEnabled"');
    expect(source).toContain("emit('updateAutoSave'");
  });

  it("provides a dedicated learning-imitation prompt category", () => {
    expect(source).toContain('label: "学习仿写设置"');
    expect(source).toContain("<LearningImitationSettingsPanel");
    expect(source).toContain("emit('saveLearningImitation', $event)");
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

  it("lets users replace a font-size value and previews valid input immediately", () => {
    expect(source).toContain('@input="previewFontSize(\'uiFontSize\', $event)"');
    expect(source).toContain('@change="commitFontSize(\'uiFontSize\', $event)"');
    expect(source).not.toContain("restoreEmptyFontSize");
  });

  it("previews valid typed colors and validates incomplete values on commit", () => {
    expect(source).toContain('@input="previewColor(\'background\', $event)"');
    expect(source).toContain('@change="commitColor(\'background\', $event)"');
    expect(source).toContain("preset: \"custom\"");
    expect(source).toContain("editingTheme.accent.toLowerCase()");
    expect(source).toContain("editingTheme.background.toLowerCase()");
    expect(source).toContain("editingTheme.foreground.toLowerCase()");
    expect(source).toContain("openColorPicker(");
    expect(source).toContain("appearance.whenReady()");
    expect(source).not.toContain(
      'appearance.updateTheme(editingScheme.value, { preset: "custom" })'
    );
  });
});
