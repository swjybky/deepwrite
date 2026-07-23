import { describe, expect, it } from "vitest";
import source from "./LibraryAgentSettingsPanel.vue?raw";

describe("LibraryAgentSettingsPanel", () => {
  it("uses one domain-parameterized panel for material and skill agents", () => {
    expect(source).toContain("domain: LibraryAgentDomain");
    expect(source).toContain("skill: {");
    expect(source).toContain("material: {");
    expect(source).toContain("技能库管理智能体");
    expect(source).toContain("素材库管理智能体");
  });

  it("provides tabbed configuration for system prompt and available skills", () => {
    expect(source).toContain('id: "system-prompt"');
    expect(source).toContain('id: "available-skills"');
    expect(source).toContain("系统提示词");
    expect(source).toContain("可用技能");
    expect(source).toContain("settings-nav");
    expect(source).not.toContain("agent-header");
    expect(source).not.toContain("工具能力");
  });

  it("edits configured skills with name, description, and content", () => {
    expect(source).toContain("readAccess.skills");
    expect(source).toContain("技能名称");
    expect(source).toContain("技能描述");
    expect(source).toContain("技能内容");
    expect(source).toContain("addSkill");
    expect(source).not.toContain("SKILL_OPTIONS");
    expect(source).not.toContain("handleSkillKindChange");
  });

  it("emits a complete settings save and a domain-scoped reset", () => {
    expect(source).toContain('emit("save", { agents })');
    expect(source).toContain('emit("reset", props.domain)');
    expect(source).toContain("恢复默认设置");
  });

  it("uses floating validation feedback without inserting transient messages", () => {
    expect(source).toContain("uiMessage.warning");
    expect(source).not.toContain("errorMessage");
    expect(source).not.toContain("statusMessage");
    expect(source).not.toContain("settings-error");
  });
});
