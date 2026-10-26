import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT,
  type ModelConfig,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";
import fieldSource from "./SubagentDrawField.vue?raw";
import editorSource from "./AgentTeamSubagentEditor.vue?raw";
import {
  cloneSubagentDraw,
  newSubagentDraw,
  savedSubagentDraw
} from "./agentTeamDrawDraft";
import {
  agentTeamDraftSignature,
  createCopiedSubagent,
  validateAgentTeamDraft
} from "./agentTeamSettingsEditorHelpers";

const judge = {
  id: "judge",
  label: "Judge",
  thinkingLevelOptions: ["high"],
  temperatureOptions: [0.2, 0.7],
  defaultThinkingLevel: "high"
} as unknown as ModelConfig;

function member(
  overrides: Partial<ShortAgentSubagentDefinition> = {}
): ShortAgentSubagentDefinition {
  return {
    id: "titler",
    name: "标题助手",
    description: "起标题",
    systemPrompt: "只输出标题。",
    enabled: true,
    agentMode: "pure-bare",
    modelMode: "inherit",
    draw: newSubagentDraw(),
    ...overrides
  };
}

const signature = (subagent: ShortAgentSubagentDefinition) =>
  agentTeamDraftSignature(false, [
    { parentAgentId: "short", subagents: [subagent] }
  ]);

describe("draw drafts", () => {
  it("keeps draft copies independent of the saved settings", () => {
    const saved = newSubagentDraw();
    const draft = cloneSubagentDraw(saved)!;
    draft.evaluator.prompt = "只看节奏";
    draft.count = 5;
    expect(saved.evaluator.prompt).toBeUndefined();
    expect(saved.count).toBe(3);

    const source = member();
    const copy = createCopiedSubagent(source, [source], "titler_2", 80);
    copy.draw!.evaluator.modelMode = "custom";
    expect(source.draw!.evaluator.modelMode).toBe("inherit");
  });

  it("stores neither the default prompt nor an untouched switched-off draw", () => {
    const draw = newSubagentDraw();
    draw.evaluator.prompt = `  ${DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT}  `;
    expect(savedSubagentDraw(draw)?.evaluator).toEqual({
      modelMode: "inherit"
    });

    expect(savedSubagentDraw({ ...newSubagentDraw(), enabled: false })).toBe(
      undefined
    );
    expect(
      savedSubagentDraw({ ...newSubagentDraw(), enabled: false, count: 6 })
    ).toMatchObject({ enabled: false, count: 6 });
  });

  it("stores the auto count mode only, keeping the fixed count beside it", () => {
    const auto = { ...newSubagentDraw(), countMode: "auto" as const, count: 6 };
    expect(savedSubagentDraw(auto)).toMatchObject({
      countMode: "auto",
      count: 6
    });
    expect(savedSubagentDraw({ ...auto, enabled: false })).toMatchObject({
      countMode: "auto"
    });
    expect(savedSubagentDraw(newSubagentDraw())).not.toHaveProperty(
      "countMode"
    );
    expect(
      savedSubagentDraw({ ...newSubagentDraw(), countMode: "fixed" })
    ).not.toHaveProperty("countMode");
    expect(cloneSubagentDraw(auto)?.countMode).toBe("auto");
    expect(signature(member({ draw: auto }))).not.toBe(
      signature(member({ draw: { ...auto, countMode: undefined } }))
    );
  });

  it("drops evaluator model fields that the chosen mode does not use", () => {
    const draw = newSubagentDraw();
    draw.evaluator = {
      modelMode: "custom",
      modelId: " judge ",
      thinkingLevel: "high",
      temperature: 0.7
    };
    expect(savedSubagentDraw(draw)?.evaluator).toEqual({
      modelMode: "custom",
      modelId: "judge",
      thinkingLevel: "high"
    });
    draw.evaluator.modelMode = "inherit";
    expect(savedSubagentDraw(draw)?.evaluator).toEqual({
      modelMode: "inherit"
    });
  });

  it("marks draw edits unsaved, but not an on-off round trip", () => {
    const pristine = member({ draw: undefined });
    const toggled = member({ draw: { ...newSubagentDraw(), enabled: false } });
    expect(signature(toggled)).toBe(signature(pristine));
    expect(signature(member())).not.toBe(signature(pristine));
    expect(
      signature(member({ draw: { ...newSubagentDraw(), count: 4 } }))
    ).not.toBe(signature(member()));
  });

  it("validates the custom model of an auto evaluator only while it applies", () => {
    const auto = member({
      draw: {
        ...newSubagentDraw(),
        selection: "auto",
        evaluator: {
          modelMode: "custom",
          modelId: "gone",
          thinkingLevel: "high"
        }
      }
    });
    expect(validateAgentTeamDraft([{ subagents: [auto] }], [judge])).toContain(
      "标题助手的评估助手"
    );
    auto.draw!.evaluator.modelId = "judge";
    expect(validateAgentTeamDraft([{ subagents: [auto] }], [judge])).toBeNull();

    const standard = member({ ...auto, agentMode: "standard" });
    standard.draw!.evaluator.modelId = "gone";
    expect(
      validateAgentTeamDraft([{ subagents: [standard] }], [judge])
    ).toBeNull();
  });
});

describe("SubagentDrawField", () => {
  it("sits under the run mode and only opens for pure members", () => {
    expect(editorSource.indexOf("<SubagentDrawField")).toBeGreaterThan(
      editorSource.indexOf("<SubagentModeField")
    );
    expect(fieldSource.indexOf('t("drawMode")')).toBeLessThan(
      fieldSource.indexOf("<AgentTeamSwitch")
    );
    expect(fieldSource).toContain(':disabled="disabled || !pure"');
    expect(fieldSource).toContain('mode === "standard" && draw.value?.enabled');
    expect(fieldSource).toContain("v-if=\"draw.selection === 'auto'\"");
    expect(fieldSource).toContain("<SubagentModelField");
    expect(fieldSource).toContain("delete draw.value.evaluator.prompt");
  });
});
