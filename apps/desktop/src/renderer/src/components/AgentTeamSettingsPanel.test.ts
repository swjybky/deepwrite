import { describe, expect, it } from "vitest";
import source from "./AgentTeamSettingsPanel.vue?raw";

describe("AgentTeamSettingsPanel", () => {
  it("explains the isolated subagent prompt and skill boundary", () => {
    expect(source).toContain("不继承主智能体提示词、会话或技能库");
    expect(source).toContain(
      "必须通过工具写回、交接摘要不能代替写入"
    );
  });

  it("shows the three workspace tabs and disables unfinished modes", () => {
    expect(source).toContain("短篇");
    expect(source).toContain("剧本");
    expect(source).toContain("长篇");
    expect(source.match(/尚未接入/g)?.length).toBe(2);
    expect(source.match(/aria-selected=\"false\"/g)?.length).toBe(2);
    expect(source.match(/role=\"tab\"/g)?.length).toBe(3);
  });

  it("maps the five short parent agents and prevents recursive delegation", () => {
    for (const label of ["人设", "剧情", "大纲", "正文", "分节"]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).toContain("不能继续创建子智能体");
    expect(source).toContain("默认跟随所属主智能体的模型");
  });

  it("supports model mode inherit or custom with PopupSelect", () => {
    expect(source).toContain("跟随主智能体");
    expect(source).toContain("单独配置模型");
    expect(source).toContain('setSubagentModelMode(subagent, \'inherit\')');
    expect(source).toContain('setSubagentModelMode(subagent, \'custom\')');
    expect(source).toContain("PopupSelect");
    expect(source).toContain("models:");
    expect(source).toContain("setSubagentThinkingLevel");
    expect(source).toContain("setSubagentTemperature");
    expect(source).toContain('v-if="subagent.thinkingLevel === \'off\'"');
    expect(source.indexOf("模型配置")).toBeLessThan(source.indexOf("<span>名称</span>"));
  });

  it("supports adding, editing, enabling, deleting and saving subagents", () => {
    expect(source).toContain('@click="addSubagent"');
    expect(source).toContain('@click="editSubagent(subagent.id)"');
    expect(source).toContain('@change="toggleSubagent(subagent, $event)"');
    expect(source).toContain('@click="removeSubagent(index)"');
    expect(source).toContain('@click="saveSettings"');
    expect(source).toContain("AgentTeamSettingsInputSchema.safeParse");
  });

  it("blocks saving and offers retry when persisted settings fail to load", () => {
    expect(source).toContain("Boolean(props.loadError)");
    expect(source).toContain('v-else-if="loadError"');
    expect(source).toContain("emit('retry')");
  });
});
