import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORT_AGENT_READ_ACCESS,
  DEFAULT_SHORT_WORKSPACE_AGENT_SYSTEM_PROMPTS,
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS,
  SHORT_WORKSPACE_AGENT_IDS,
  SHORT_WORKSPACE_STAGE_IDS,
  ShortWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceAgentSettingsSchema,
  ShortWorkspaceSnapshotSchema,
  WorkspaceAgentsListCommandEnvelopeSchema,
  WorkspaceAgentsResetCommandEnvelopeSchema,
  WorkspaceAgentsSaveCommandEnvelopeSchema,
  createDefaultExpertDraft,
  createShortWorkspaceContentRevision,
  createEnvelope,
  parseExpertDraftMarkdown,
  resolveShortWorkspaceAgentIdForStage,
  serializeExpertDraftMarkdown,
  updateExpertDraftSectionBody
} from "./index";

describe("short workspace contracts", () => {
  it("maps all six content stages to the five workspace agents", () => {
    expect(SHORT_WORKSPACE_STAGE_IDS).toEqual([
      "character_design",
      "plot_design",
      "intro_design",
      "plot_refine",
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
    ).toEqual({
      character_design: "character_design",
      plot_design: "plot_design",
      intro_design: "plot_design",
      plot_refine: "plot_design",
      outline: "outline",
      draft: "expert_draft_coordinator"
    });
  });

  it("exposes five complete default agent profiles", () => {
    expect(DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((profile) => profile.id)).toEqual(
      SHORT_WORKSPACE_AGENT_IDS
    );
    expect(DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES).toHaveLength(5);
    for (const profile of DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES) {
      expect(profile.label).not.toBe("");
      expect(profile.description).not.toBe("");
      expect(profile.systemPrompt).toMatch(/^你是 DeepWrite 的短篇/);
      expect(profile.systemPrompt.endsWith("\n")).toBe(true);
    }
    expect(() =>
      ShortWorkspaceAgentSettingsSchema.parse(DEFAULT_SHORT_WORKSPACE_AGENT_SETTINGS)
    ).not.toThrow();
  });

  it("preserves the five reference shared prompt files byte-for-byte", () => {
    const digest = (value: string): string => {
      let hash = 2_166_136_261;
      for (const byte of new TextEncoder().encode(value)) {
        hash ^= byte;
        hash = Math.imul(hash, 16_777_619) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    };

    expect(
      Object.fromEntries(
        Object.entries(DEFAULT_SHORT_WORKSPACE_AGENT_SYSTEM_PROMPTS).map(
          ([agentId, prompt]) => [agentId, digest(prompt)]
        )
      )
    ).toEqual({
      character_design: "d758185c",
      plot_design: "6ed0f6fe",
      outline: "2479c31a",
      expert_draft_coordinator: "0292a648",
      expert_section_writer: "f5b16bd2"
    });
  });

  it("keeps the reference project's default read ranges", () => {
    expect(DEFAULT_SHORT_AGENT_READ_ACCESS).toEqual({
      character_design: {
        workspace: ["character_design", "plot_design"],
        material: ["character"],
        skill: ["general", "plot", "other"]
      },
      plot_design: {
        workspace: [
          "character_design",
          "plot_design",
          "intro_design",
          "plot_refine"
        ],
        material: ["gimmick", "character", "plot"],
        skill: ["general", "plot", "other"]
      },
      outline: {
        workspace: [
          "plot_design",
          "intro_design",
          "plot_refine",
          "outline",
          "character_design"
        ],
        material: [],
        skill: ["general", "other"]
      },
      expert_draft_coordinator: {
        workspace: ["outline", "draft"],
        material: [],
        skill: ["general", "other"]
      },
      expert_section_writer: {
        workspace: ["outline", "plot_refine", "draft"],
        material: ["draft"],
        skill: ["style", "general"]
      }
    });
  });

  it("validates a complete short workspace snapshot", () => {
    const snapshot = {
      id: "book_1",
      title: "测试短篇",
      categories: ["悬疑"],
      activeStageId: "plot_refine" as const,
      stages: SHORT_WORKSPACE_STAGE_IDS.map((stageId) => ({
        stageId,
        title: stageId,
        content: stageId === "plot_refine" ? "雨夜留下了一枚钥匙。" : "",
        revision: createShortWorkspaceContentRevision(
          stageId === "plot_refine" ? "雨夜留下了一枚钥匙。" : ""
        )
      }))
    };

    const parsed = ShortWorkspaceSnapshotSchema.parse(snapshot);
    expect(parsed.stages).toHaveLength(6);
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
    const draftContent = serializeExpertDraftMarkdown(
      updateExpertDraftSectionBody(
        createDefaultExpertDraft(),
        "section-1",
        "雨夜留下了一枚钥匙。"
      )
    );
    const stages = SHORT_WORKSPACE_STAGE_IDS.map((stageId) => {
      const content = stageId === "draft" ? draftContent : "";
      return {
        stageId,
        title: stageId,
        content,
        revision: createShortWorkspaceContentRevision(content)
      };
    });
    const base = {
      id: "book_1",
      title: "测试短篇",
      categories: ["悬疑"],
      stages
    };

    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "plot_refine",
        activeAgentId: "plot_design"
      })
    ).not.toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "plot_refine",
        activeAgentId: "outline"
      })
    ).toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "plot_refine",
        activeAgentId: "plot_design",
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
    ).toThrow();
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
    ).toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "expert_section_writer",
        activeSectionId: "section-1"
      })
    ).not.toThrow();
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
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...base,
        activeStageId: "draft",
        activeAgentId: "outline"
      })
    ).toThrow();

    const longDraft = serializeExpertDraftMarkdown({
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "",
          body: "雨".repeat(20_100),
          characterState: ""
        },
        {
          id: "section-2",
          title: "第二节",
          wordCountRequirement: "",
          body: "天亮了。",
          characterState: ""
        }
      ]
    });
    const truncatedStages = stages.map((stage) =>
      stage.stageId === "draft"
        ? {
            ...stage,
            content: longDraft.slice(0, 20_000),
            revision: createShortWorkspaceContentRevision(longDraft),
            truncated: true,
            originalLength: longDraft.length
          }
        : stage
    );
    const truncatedTarget = {
      ...base,
      stages: truncatedStages,
      activeStageId: "draft",
      activeAgentId: "expert_section_writer",
      activeSectionId: "section-2"
    };
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...truncatedTarget,
        expertDraftSectionIds: ["section-1", "section-2"],
        expertDraftSections: parseExpertDraftMarkdown(longDraft).sections
      })
    ).not.toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...truncatedTarget,
        expertDraftSectionIds: ["section-1", "section-2"]
      })
    ).toThrow();
    expect(() => ShortWorkspaceSnapshotSchema.parse(truncatedTarget)).toThrow();
    expect(() =>
      ShortWorkspaceSnapshotSchema.parse({
        ...truncatedTarget,
        expertDraftSectionIds: ["section-1", "section-404"]
      })
    ).toThrow();
  });

  it("validates settings input and workspaceAgents command envelopes", () => {
    const input = {
      workspaceType: "short" as const,
      agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map(
        ({ id, systemPrompt, readAccess }) => ({ id, systemPrompt, readAccess })
      )
    };

    expect(ShortWorkspaceAgentSettingsInputSchema.parse(input).agents).toHaveLength(5);
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
        agents: input.agents.map((agent, index) =>
          index === 1 ? { ...agent, id: "character_design" as const } : agent
        )
      })
    ).toThrow();
  });
});
