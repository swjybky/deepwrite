import { describe, expect, it } from "vitest";
import source from "./LibraryAgentSettingsPanel.vue?raw";

describe("LibraryAgentSettingsPanel", () => {
  it("uses one domain-parameterized panel for material and skill agents", () => {
    expect(source).toContain("domain: LibraryAgentDomain");
    expect(source).toContain('skill: {');
    expect(source).toContain('material: {');
    expect(source).toContain("技能库管理智能体");
    expect(source).toContain("素材库管理智能体");
  });

  it("shows fixed read, search, write, and edit capabilities", () => {
    expect(source).toContain('{ label: "读取"');
    expect(source).toContain('{ label: "搜索"');
    expect(source).toContain('{ label: "写入"');
    expect(source).toContain('{ label: "编辑"');
    expect(source).toContain("工具权限由客户端固定校验，不会因提示词内容而扩大");
    expect(source).toContain("官方只读技能库仅提供读取和搜索能力");
  });

  it("emits a complete settings save and a domain-scoped reset", () => {
    expect(source).toContain('emit("save", {');
    expect(source).toContain("agents: props.settings.agents.map");
    expect(source).toContain('emit("reset", props.domain)');
    expect(source).toContain("恢复默认提示词");
  });

  it("uses floating validation feedback without inserting transient messages", () => {
    expect(source).toContain("uiMessage.warning");
    expect(source).not.toContain("errorMessage");
    expect(source).not.toContain("statusMessage");
    expect(source).not.toContain("settings-error");
  });
});
