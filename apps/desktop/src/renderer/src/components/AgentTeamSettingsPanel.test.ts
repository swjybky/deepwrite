import { DEFAULT_LONG_AGENT_TEAM_SETTINGS } from "@deepwrite/contracts";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import LongAgentTeamSettingsPanel from "./LongAgentTeamSettingsPanel.vue";
import { SUBAGENT_AGENT_MODE_LABELS } from "./agentTeamSettingsMeta";

describe("AgentTeamSettingsPanel", () => {
  it("labels all three run modes distinctly", () => {
    const labels = Object.values(SUBAGENT_AGENT_MODE_LABELS);
    expect(Object.keys(SUBAGENT_AGENT_MODE_LABELS)).toEqual([
      "standard",
      "pure-read",
      "pure-bare"
    ]);
    expect(new Set(labels).size).toBe(3);
    expect(
      labels.every((label) => label && !label.startsWith("agentMode"))
    ).toBe(true);
  });

  it("hides mutating controls while keeping subagent inspection in readOnly mode", async () => {
    const baseProps = {
      settings: structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS),
      models: [],
      skills: [],
      preferredModelId: null,
      loading: false,
      saving: false,
      loadError: null,
      runtimeAvailable: false,
      authoringGenerating: false,
      authoringDraft: null,
      authoringStatusText: null,
      authoringError: null
    };

    const editableHtml = await renderToString(
      createSSRApp(LongAgentTeamSettingsPanel, {
        ...baseProps,
        readOnly: false
      })
    );
    expect(editableHtml).toContain("保存智能体团队");
    expect(editableHtml).toContain("新增子智能体");
    expect(editableHtml).toContain("从技能库加载");
    expect(editableHtml).toContain("章节写手");

    const readOnlyHtml = await renderToString(
      createSSRApp(LongAgentTeamSettingsPanel, {
        ...baseProps,
        readOnly: true
      })
    );
    expect(readOnlyHtml).not.toContain("保存智能体团队");
    expect(readOnlyHtml).not.toContain("新增子智能体");
    expect(readOnlyHtml).not.toContain("从技能库加载");
    expect(readOnlyHtml).toContain("章节写手");
    expect(readOnlyHtml).toContain("连续性记录员");
  });
});
