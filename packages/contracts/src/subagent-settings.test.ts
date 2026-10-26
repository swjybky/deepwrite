import { describe, expect, it } from "vitest";
import {
  AgentUserInputRequestedPayloadSchema,
  ShortAgentSubagentDefinitionSchema,
  SubagentDrawRefSchema,
  SubagentDrawSettingsSchema,
  SubagentDrawUpdatedPayloadSchema,
  activeSubagentDraw,
  subagentCustomModelIds
} from "./index";

const member = {
  id: "titler",
  name: "标题助手",
  description: "起章节标题。",
  systemPrompt: "只输出标题。",
  enabled: true
};

describe("subagent draw settings", () => {
  it("fills defaults and keeps older definitions without draw", () => {
    expect(SubagentDrawSettingsSchema.parse({ enabled: true })).toEqual({
      enabled: true,
      count: 3,
      selection: "manual",
      evaluator: { modelMode: "inherit" }
    });
    expect(ShortAgentSubagentDefinitionSchema.parse(member).draw).toBe(
      undefined
    );
  });

  it("treats an absent count mode as fixed and keeps the count in auto", () => {
    const auto = SubagentDrawSettingsSchema.parse({
      enabled: true,
      countMode: "auto",
      count: 5
    });
    expect(auto).toMatchObject({ countMode: "auto", count: 5 });
    expect(
      SubagentDrawSettingsSchema.parse({ enabled: true }).countMode
    ).toBeUndefined();
    expect(
      SubagentDrawSettingsSchema.safeParse({ enabled: true, countMode: "many" })
        .success
    ).toBe(false);
  });

  it("limits the count to 2–10 and validates a custom evaluator model", () => {
    for (const count of [1, 11, 2.5]) {
      expect(
        SubagentDrawSettingsSchema.safeParse({ enabled: true, count }).success
      ).toBe(false);
    }
    const result = ShortAgentSubagentDefinitionSchema.safeParse({
      ...member,
      draw: { enabled: true, evaluator: { modelMode: "custom" } }
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
        expect.arrayContaining([
          "draw.evaluator.modelId",
          "draw.evaluator.thinkingLevel"
        ])
      );
    }
  });

  it("takes effect only on an enabled pure member", () => {
    const draw = SubagentDrawSettingsSchema.parse({ enabled: true });
    expect(activeSubagentDraw({ agentMode: "pure-read", draw })).toBe(draw);
    expect(activeSubagentDraw({ agentMode: "standard", draw })).toBe(undefined);
    expect(
      activeSubagentDraw({
        agentMode: "pure-bare",
        draw: { ...draw, enabled: false }
      })
    ).toBe(undefined);
  });

  it("asks Main to resolve the models of custom members and auto evaluators", () => {
    const evaluator = {
      modelMode: "custom" as const,
      modelId: "judge",
      thinkingLevel: "high" as const
    };
    expect(
      subagentCustomModelIds([
        { modelMode: "custom", modelId: "writer" },
        {
          modelMode: "inherit",
          agentMode: "pure-bare",
          draw: { enabled: true, count: 3, selection: "auto", evaluator }
        },
        {
          modelMode: "inherit",
          agentMode: "pure-bare",
          draw: { enabled: true, count: 3, selection: "manual", evaluator }
        },
        {
          modelMode: "custom",
          modelId: "writer",
          agentMode: "standard",
          draw: { enabled: true, count: 3, selection: "auto", evaluator }
        }
      ])
    ).toEqual(["writer", "judge"]);
  });
});

describe("draw events and selection requests", () => {
  const request = {
    sessionId: "session-1",
    runId: "run-1",
    requestId: "run-1:user-input:1",
    toolCallId: "call-1",
    questions: [{ id: "draw", question: "选一份交给主智能体。" }],
    runtime: { provider: "faux", model: "faux", mode: "local-faux" }
  };
  const draw = {
    parentToolCallId: "call-1",
    subagentId: "titler",
    name: "标题助手",
    task: "起标题",
    count: 3,
    candidates: [
      { id: "c1", index: 0, subagentRunId: "subrun_1", text: "甲" },
      { id: "c3", index: 2, subagentRunId: "subrun_3", text: "丙" }
    ]
  };

  it("pairs the subagent_draw source with its candidates", () => {
    expect(
      AgentUserInputRequestedPayloadSchema.safeParse({
        ...request,
        source: "subagent_draw",
        draw
      }).success
    ).toBe(true);
    expect(
      AgentUserInputRequestedPayloadSchema.safeParse({
        ...request,
        source: "subagent_draw"
      }).success
    ).toBe(false);
    expect(
      AgentUserInputRequestedPayloadSchema.safeParse({
        ...request,
        source: "ask_user_question",
        draw
      }).success
    ).toBe(false);
    expect(
      AgentUserInputRequestedPayloadSchema.safeParse({
        ...request,
        source: "subagent_draw",
        draw: {
          ...draw,
          candidates: [{ ...draw.candidates[0], id: "c11" }, draw.candidates[1]]
        }
      }).success
    ).toBe(false);
  });

  it("carries each candidate's focus within its length limit", () => {
    const withVariant = (variant: string) =>
      AgentUserInputRequestedPayloadSchema.safeParse({
        ...request,
        source: "subagent_draw",
        draw: {
          ...draw,
          candidates: [{ ...draw.candidates[0], variant }, draw.candidates[1]]
        }
      }).success;
    expect(withVariant("冷峻")).toBe(true);
    expect(withVariant("长".repeat(1_001))).toBe(false);
    expect(
      SubagentDrawRefSchema.parse({
        role: "candidate",
        index: 0,
        count: 2,
        variant: " 冷峻 "
      })
    ).toEqual({ role: "candidate", index: 0, count: 2, variant: "冷峻" });
  });

  it("names the selection only when a draw is selected", () => {
    const base = {
      sessionId: "session-1",
      runId: "run-1",
      parentToolCallId: "call-1",
      subagentId: "titler",
      name: "标题助手",
      count: 3
    };
    expect(
      SubagentDrawUpdatedPayloadSchema.safeParse({
        ...base,
        phase: "selected",
        selectedBy: "evaluator",
        selectedIndex: 2,
        reason: "节奏最好"
      }).success
    ).toBe(true);
    expect(
      SubagentDrawUpdatedPayloadSchema.safeParse({ ...base, phase: "selected" })
        .success
    ).toBe(false);
    expect(
      SubagentDrawUpdatedPayloadSchema.safeParse({
        ...base,
        phase: "selecting",
        selectedBy: "user",
        selectedIndex: 0
      }).success
    ).toBe(false);
  });
});
