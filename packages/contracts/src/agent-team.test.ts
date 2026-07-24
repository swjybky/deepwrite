import { describe, expect, it } from "vitest";
import {
  AgentPromptCommandPayloadSchema,
  AgentTeamSettingsInputSchema,
  CommandEnvelopeSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SubagentActivityEventEnvelopeSchema,
  createEnvelope,
  createShortWorkspaceContentRevision,
  type ShortAgentSubagentDefinition
} from "./index";

const definition: ShortAgentSubagentDefinition = {
  id: "continuity_reviewer",
  name: "连续性审阅",
  description: "检查人物状态、时间线和伏笔是否前后一致。",
  systemPrompt: "只检查连续性问题，并把结论摘要交还主智能体。",
  enabled: true,
  modelMode: "inherit"
};

function completeSettings() {
  return {
    workspaceType: "short" as const,
    teams: DEFAULT_AGENT_TEAM_SETTINGS.teams.map((team) => ({
      parentAgentId: team.parentAgentId,
      subagents:
        team.parentAgentId === "outline" ? [{ ...definition }] : []
    }))
  };
}

function shortWorkspace() {
  const revision = createShortWorkspaceContentRevision("");
  return {
    id: "book-1",
    title: "雨夜来信",
    categories: ["悬疑"],
    activeStageId: "outline" as const,
    expertDraft: {
      id: "draft" as const,
      title: "正文",
      revision,
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "1000 字",
          body: {
            documentId: "draft:section-1:body",
            title: "第一节",
            content: "",
            revision
          },
          characterState: {
            documentId: "draft:section-1:character-state",
            title: "第一节 · 人物状态",
            content: "",
            revision
          }
        }
      ]
    },
    stages: [
      "character_design",
      "plot_design",
      "intro_design",
      "plot_refine",
      "outline"
    ].map((stageId) => ({
      stageId,
      title: stageId,
      content: "",
      revision
    }))
  };
}

describe("agent-team contracts", () => {
  it("accepts the fixed five-team short workspace shape", () => {
    expect(AgentTeamSettingsInputSchema.parse(completeSettings())).toEqual(
      completeSettings()
    );
  });

  it("defaults missing modelMode to inherit and requires modelId for custom", () => {
    const legacy = completeSettings();
    const outline = legacy.teams.find((team) => team.parentAgentId === "outline")!;
    outline.subagents = [
      {
        id: "legacy_helper",
        name: "旧配置助手",
        description: "无模型字段的旧数据。",
        systemPrompt: "保持兼容。",
        enabled: true
      } as ShortAgentSubagentDefinition
    ];
    const parsed = AgentTeamSettingsInputSchema.parse(legacy);
    expect(
      parsed.teams.find((team) => team.parentAgentId === "outline")?.subagents[0]
    ).toMatchObject({ modelMode: "inherit" });

    const customMissingModel = completeSettings();
    customMissingModel.teams.find(
      (team) => team.parentAgentId === "outline"
    )!.subagents = [
      {
        ...definition,
        modelMode: "custom"
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customMissingModel).success
    ).toBe(false);

    const customWithModel = completeSettings();
    customWithModel.teams.find(
      (team) => team.parentAgentId === "outline"
    )!.subagents = [
      {
        ...definition,
        modelMode: "custom",
        modelId: "model-local-1",
        thinkingLevel: "medium"
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customWithModel).success
    ).toBe(true);

    const customOffWithoutTemperature = completeSettings();
    customOffWithoutTemperature.teams.find(
      (team) => team.parentAgentId === "outline"
    )!.subagents = [
      {
        ...definition,
        modelMode: "custom",
        modelId: "model-local-1",
        thinkingLevel: "off"
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customOffWithoutTemperature).success
    ).toBe(false);

    const customOffWithTemperature = completeSettings();
    customOffWithTemperature.teams.find(
      (team) => team.parentAgentId === "outline"
    )!.subagents = [
      {
        ...definition,
        modelMode: "custom",
        modelId: "model-local-1",
        thinkingLevel: "off",
        temperature: 0.7
      }
    ];
    expect(
      AgentTeamSettingsInputSchema.safeParse(customOffWithTemperature).success
    ).toBe(true);
  });

  it("rejects duplicate ids and names inside one parent team", () => {
    const duplicate = completeSettings();
    duplicate.teams.find((team) => team.parentAgentId === "outline")!.subagents = [
      { ...definition },
      { ...definition, id: "other", name: definition.name.toUpperCase() }
    ];

    const result = AgentTeamSettingsInputSchema.safeParse(duplicate);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.at(-1))).toContain(
        "name"
      );
    }
  });

  it("keeps subagent definitions internal to agent.prompt", () => {
    const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
      (candidate) => candidate.id === "outline"
    )!;
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        sessionId: "session-1",
        message: "审阅大纲",
        workspaceContext: { shortWorkspace: shortWorkspace() },
        agentProfile: profile,
        subagentDefinitions: [definition]
      }).success
    ).toBe(true);
    expect(
      AgentPromptCommandPayloadSchema.safeParse({
        sessionId: "session-1",
        message: "审阅大纲",
        subagentDefinitions: [definition]
      }).success
    ).toBe(false);
  });

  it("registers agentTeams commands and validates subagent event parent identity", () => {
    const command = createEnvelope(
      "agentTeams.list",
      { workspaceType: "short" as const },
      { id: "cmd-1" }
    );
    expect(CommandEnvelopeSchema.safeParse(command).success).toBe(true);

    const event = createEnvelope(
      "subagent.activity",
      {
        sessionId: "session-1",
        runId: "run-1",
        parentToolCallId: "tool-parent",
        subagentRunId: "sub-run-1",
        subagentId: definition.id,
        name: definition.name,
        runtime: { provider: "local", model: "test", mode: "local-faux" as const },
        activity: { type: "message_delta" as const, delta: "完成" }
      },
      {
        id: "evt-1",
        context: { sessionId: "session-1", runId: "wrong-run" }
      }
    );
    expect(SubagentActivityEventEnvelopeSchema.safeParse(event).success).toBe(
      false
    );
  });
});
