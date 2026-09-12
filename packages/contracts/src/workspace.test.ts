import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORT_AGENT_READ_ACCESS,
  DEFAULT_SHORT_SYSTEM_PROMPT,
  DEFAULT_SHORT_STAGE_READ_ACCESS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SYSTEM_PROMPTS,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  SHORT_WORKSPACE_AGENT_IDS,
  SHORT_WORKSPACE_STAGE_IDS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  ShortWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceAgentSettingsSchema,
  ShortWorkspaceSnapshotSchema,
  WorkspaceAgentsListCommandEnvelopeSchema,
  WorkspaceAgentsResetCommandEnvelopeSchema,
  WorkspaceAgentsSaveCommandEnvelopeSchema,
  createShortWorkspaceContentRevision,
  createExpertDraftDirectoryRevision,
  createEnvelope,
  createDefaultCreativePlotStages,
  resolveShortWorkspaceAgentIdForStage,
  resolveShortWorkspaceConversationLaneIdForStage,
  resolveShortWorkspaceStageReadAccess
} from "./index";

function expertDraftFile(documentId: string, title: string, content: string) {
  return {
    documentId,
    title,
    content,
    revision: createShortWorkspaceContentRevision(content)
  };
}

function workspaceSnapshot() {
  return {
    id: "book_1",
    title: "测试短篇",
    categories: ["悬疑"],
    activeStageId: "plot_refine" as const,
    plotStages: createDefaultCreativePlotStages(),
    expertDraft: {
      id: "draft" as const,
      title: "正文",
      revision: createShortWorkspaceContentRevision("draft-directory"),
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "1000 字",
          body: expertDraftFile(
            "draft:section-1:body",
            "第一节·正文",
            "雨夜留下了一枚钥匙。"
          ),
          characterState: expertDraftFile(
            "draft:section-1:state",
            "第一节·人物状态",
            "林默拿到了钥匙。"
          )
        },
        {
          id: "section-2",
          title: "第二节",
          wordCountRequirement: "1200 字",
          body: expertDraftFile(
            "draft:section-2:body",
            "第二节·正文",
            "天亮了。"
          ),
          characterState: expertDraftFile(
            "draft:section-2:state",
            "第二节·人物状态",
            ""
          )
        }
      ]
    },
    stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => {
      const content = stageId === "plot_refine" ? "雨夜留下了一枚钥匙。" : "";
      return {
        stageId,
        title: stageId,
        content,
        revision: createShortWorkspaceContentRevision(content)
      };
    })
  };
}

describe("short workspace contracts", () => {
  it("maps every work stage to one runtime agent and keeps legacy conversation lanes", () => {
    expect(SHORT_WORKSPACE_STAGE_IDS).toEqual([
      "character_design",
      "worldbuilding",
      "plot_design",
      "intro_design",
      "plot_refine",
      "narrative_perspective",
      "outline",
      "draft"
    ]);
    expect(
      Object.fromEntries(
        SHORT_WORKSPACE_STAGE_IDS.map((stageId) => [
          stageId,
          resolveShortWorkspaceAgentIdForStage(stageId)
        ])
      )
    ).toEqual(
      Object.fromEntries(SHORT_WORKSPACE_STAGE_IDS.map((id) => [id, "short"]))
    );
    expect(
      resolveShortWorkspaceConversationLaneIdForStage("character_design")
    ).toBe("character_design");
    expect(resolveShortWorkspaceConversationLaneIdForStage("outline")).toBe(
      "plot_design"
    );
    expect(resolveShortWorkspaceConversationLaneIdForStage("draft")).toBe(
      "expert_draft_coordinator"
    );
  });

  it("exposes one complete default agent profile", () => {
    expect(
      DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((profile) => profile.id)
    ).toEqual(SHORT_WORKSPACE_AGENT_IDS);
    expect(DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES).toHaveLength(1);
    for (const profile of DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES) {
      expect(profile.label).not.toBe("");
      expect(profile.description).not.toBe("");
      expect(profile.systemPrompt).toMatch(/^你是 DeepWrite 的/);
      expect(profile.systemPrompt.endsWith("\n")).toBe(true);
      expect(profile.welcomeShortcuts).toHaveLength(3);
      expect(
        profile.welcomeShortcuts.every((value) => value.trim().length > 0)
      ).toBe(true);
    }
    expect(() =>
      ShortWorkspaceAgentSettingsSchema.parse(
        DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS
      )
    ).not.toThrow();
    expect(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS.defaultPlotStageIds).toEqual([
      "plot_design",
      "intro_design",
      "plot_refine"
    ]);
    expect(
      ShortWorkspaceAgentSettingsInputSchema.safeParse({
        ...DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
        defaultPlotStageIds: []
      }).success
    ).toBe(false);
  });

  it("uses one prompt aligned with the unified tools", () => {
    expect(DEFAULT_SHORT_WORKSPACE_AGENT_SYSTEM_PROMPTS).toEqual({
      short: DEFAULT_SHORT_SYSTEM_PROMPT
    });
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain("read");
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain("create、edit");
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain("当前阶段");
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain(
      "文本样式下禁止 create character"
    );
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain("所有人物写在同一份文本里");
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain(
      "只有条目样式才用 kind=character 为单个人物创建独立条目"
    );
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain(
      "读取、写入或修改小节正文/人物状态时必须同时给出 document=body 或 character_state，不得省略"
    );
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain(
      "读取单个小节必须给出 kind=draft_section、稳定小节 id 和 document=body 或 character_state"
    );
    expect(DEFAULT_SHORT_SYSTEM_PROMPT).toContain("不传 document 时默认 body");
  });

  it("keeps only material and skill read ranges", () => {
    expect(DEFAULT_SHORT_AGENT_READ_ACCESS).toEqual({
      short: {
        material: ["character", "gimmick", "plot", "draft", "other"],
        skill: ["general", "plot", "style", "other"]
      }
    });
    expect(DEFAULT_SHORT_STAGE_READ_ACCESS).toEqual({
      character: {
        material: ["character"],
        skill: ["general", "plot", "other"]
      },
      plot: {
        material: ["gimmick", "character", "plot"],
        skill: ["general", "plot", "other"]
      },
      draft: {
        material: ["character", "gimmick", "plot", "draft", "other"],
        skill: ["style", "general", "other"]
      }
    });
    expect(resolveShortWorkspaceStageReadAccess("outline")).toEqual(
      DEFAULT_SHORT_STAGE_READ_ACCESS.plot
    );

    const legacy = structuredClone(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS);
    Object.assign(legacy.agents[0]!.readAccess, {
      workspace: ["character_design"]
    });
    expect(
      ShortWorkspaceAgentSettingsInputSchema.safeParse(legacy).success
    ).toBe(false);
  });

  it("validates a complete short workspace snapshot", () => {
    const snapshot = workspaceSnapshot();

    const parsed = ShortWorkspaceSnapshotSchema.parse(snapshot);
    expect(parsed.stages).toHaveLength(SHORT_WORKSPACE_TEXT_STAGE_IDS.length);
    expect(parsed.stages.map((stage) => stage.stageId)).toEqual(
      SHORT_WORKSPACE_TEXT_STAGE_IDS
    );
    expect(parsed.expertDraft.sections).toHaveLength(2);
    expect(parsed).not.toHaveProperty("activeAgentId");
    expect(parsed).not.toHaveProperty("activeSectionId");
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...snapshot,
        stages: snapshot.stages.map((stage, index) =>
          index === 1 ? { ...stage, stageId: "character_design" } : stage
        )
      })
    ).toThrow();
  });

  it("validates active agents and draft section targets", () => {
    const base = workspaceSnapshot();

    expect(
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "plot_refine",
        activeAgentId: "plot_design"
      }).activeAgentId
    ).toBe("short");
    expect(
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "plot_refine",
        activeAgentId: "character_design"
      }).activeAgentId
    ).toBe("short");
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "plot_refine",
        activeAgentId: "short",
        activeSectionId: "section-1"
      })
    ).toThrow();

    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft"
      })
    ).not.toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeSectionId: "section-1"
      })
    ).not.toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "expert_draft_coordinator"
      })
    ).not.toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "expert_draft_coordinator",
        activeSectionId: "section-1"
      })
    ).not.toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "expert_section_writer",
        activeSectionId: "section-1"
      })
    ).toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "expert_section_writer"
      })
    ).toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "expert_section_writer",
        activeSectionId: "section-404"
      })
    ).toThrow();
    expect(
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "character_design"
      }).activeAgentId
    ).toBe("short");

    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        expertDraft: {
          ...base.expertDraft,
          sections: [
            base.expertDraft.sections[0],
            {
              ...base.expertDraft.sections[1],
              body: {
                ...base.expertDraft.sections[1]!.body,
                documentId: base.expertDraft.sections[0]!.body.documentId
              }
            }
          ]
        }
      })
    ).toThrow();
  });

  it("validates settings input and workspaceAgents command envelopes", () => {
    const input = {
      workspaceType: "short" as const,
      agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map(
        ({ id, systemPrompt, welcomeShortcuts, readAccess }) => ({
          id,
          systemPrompt,
          welcomeShortcuts,
          readAccess
        })
      )
    };

    expect(
      ShortWorkspaceAgentSettingsInputSchema.parse(input).agents
    ).toHaveLength(1);
    expect(
      WorkspaceAgentsListCommandEnvelopeSchema.parse(
        createEnvelope(
          "workspaceAgents.list",
          { workspaceType: "short" as const },
          { id: "workspace_agents_list" }
        )
      ).type
    ).toBe("workspaceAgents.list");
    expect(
      WorkspaceAgentsSaveCommandEnvelopeSchema.parse(
        createEnvelope("workspaceAgents.save", input, {
          id: "workspace_agents_save"
        })
      ).type
    ).toBe("workspaceAgents.save");
    expect(
      WorkspaceAgentsResetCommandEnvelopeSchema.parse(
        createEnvelope(
          "workspaceAgents.reset",
          { workspaceType: "short" as const },
          { id: "workspace_agents_reset" }
        )
      ).type
    ).toBe("workspaceAgents.reset");

    expect(() =>
      ShortWorkspaceAgentSettingsInputSchema.parse({
        ...input,
        agents: [{ ...input.agents[0], id: "character_design" as const }]
      })
    ).toThrow();
  });
});

describe("createExpertDraftDirectoryRevision", () => {
  it("ignores body and character-state content when hashing the directory", () => {
    const sections = [
      {
        id: "section-1",
        title: "第一节",
        wordCountRequirement: "1000 字"
      },
      {
        id: "section-2",
        title: "第二节",
        wordCountRequirement: ""
      }
    ];
    const first = createExpertDraftDirectoryRevision(sections);
    const second = createExpertDraftDirectoryRevision(sections);
    expect(first).toBe(second);
    expect(first).not.toBe(createShortWorkspaceContentRevision("任意正文"));
    expect(createExpertDraftDirectoryRevision(sections)).toBe(
      createExpertDraftDirectoryRevision([
        { ...sections[0]! },
        { ...sections[1]! }
      ])
    );
  });

  it("changes when structure changes", () => {
    const base = createExpertDraftDirectoryRevision([
      { id: "section-1", title: "第一节", wordCountRequirement: "1000 字" }
    ]);
    const renamed = createExpertDraftDirectoryRevision([
      { id: "section-1", title: "新标题", wordCountRequirement: "1000 字" }
    ]);
    const added = createExpertDraftDirectoryRevision([
      { id: "section-1", title: "第一节", wordCountRequirement: "1000 字" },
      { id: "pending:section:1", title: "第二节", wordCountRequirement: "" }
    ]);
    expect(renamed).not.toBe(base);
    expect(added).not.toBe(base);
  });
});
