import { describe, expect, it } from "vitest";
import {
  EMPTY_LEARNING_IMITATION_RESULT,
  LEARNING_IMITATION_STAGE_IDS,
  LearningImitationRuntimeContextSchema,
  LearningImitationSettingsInputSchema,
  applyLearningImitationWrite,
  renderLearningImitationSystemPrompt
} from "./learning-imitation";

function document(id: string, text = "第一章\n雨夜里，她终于决定离开。") {
  return {
    id,
    name: `${id}.txt`,
    extension: ".txt",
    mediaType: "text/plain",
    size: text.length,
    text,
    charCount: text.replace(/\s/gu, "").length
  };
}

describe("learning imitation contracts", () => {
  it("requires one complete prompt for every learning stage", () => {
    const prompts = LEARNING_IMITATION_STAGE_IDS.map((id) => ({
      id,
      systemPrompt: `prompt:${id}`
    }));
    expect(LearningImitationSettingsInputSchema.parse({ prompts }).prompts).toHaveLength(3);
    expect(() =>
      LearningImitationSettingsInputSchema.parse({
        prompts: [prompts[0], prompts[0], prompts[2]]
      })
    ).toThrow();
  });

  it("bounds and validates the document collection", () => {
    const context = LearningImitationRuntimeContextSchema.parse({
      stageId: "material_split",
      documents: [document("sample")],
      result: EMPTY_LEARNING_IMITATION_RESULT
    });
    expect(context.documents[0]?.charCount).toBeGreaterThan(0);
    expect(() =>
      LearningImitationRuntimeContextSchema.parse({
        stageId: "material_split",
        documents: [],
        result: EMPTY_LEARNING_IMITATION_RESULT
      })
    ).toThrow();
  });

  it("merges only the active stage and honors append mode", () => {
    const first = applyLearningImitationWrite(
      structuredClone(EMPTY_LEARNING_IMITATION_RESULT),
      "plot_learning",
      { plot_design_skill: "先建立冲突" }
    );
    const next = applyLearningImitationWrite(first, "plot_learning", {
      mode: "append",
      plot_design_skill: "再用选择触发转折"
    });
    expect(next.plot_learning.plotDesignSkill).toBe(
      "先建立冲突\n\n再用选择触发转折"
    );
    expect(next.material_split.gimmick).toBe("");
  });

  it("renders the five supported dynamic placeholders", () => {
    const context = LearningImitationRuntimeContextSchema.parse({
      stageId: "style_learning",
      documents: [document("sample")],
      result: {
        ...structuredClone(EMPTY_LEARNING_IMITATION_RESULT),
        style_learning: { title: "冷峻文风", body: "短句收束。" }
      }
    });
    const rendered = renderLearningImitationSystemPrompt(
      "{{STAGE_ID}}|{{STAGE_LABEL}}|{{DOCUMENT_COUNT}}\n{{DOCUMENTS_SUMMARY}}\n{{CURRENT_RESULT}}",
      context
    );
    expect(rendered).toContain("style_learning|文风学习|1");
    expect(rendered).toContain("sample.txt");
    expect(rendered).toContain("冷峻文风");
  });
});
