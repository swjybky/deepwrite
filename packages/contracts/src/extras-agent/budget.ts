import { assertRevisionAnalysisBudget } from "../revision-analysis-budget";
import { assertShortAnalysisBudget } from "../short-book-analysis-budget";
import { assertStyleComparisonBudget } from "../style-comparison";
import { LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW } from "../long-material-pack/constants";
import {
  longMaterialEvidenceTokens,
  longMaterialGuideEvidenceTokens
} from "../long-material-pack/guide";
import type { ExtrasAgentTask, ExtrasAgentResolvedTask } from "./tasks";

interface ModelCapacity {
  contextWindow?: number | undefined;
  maxTokens?: number | undefined;
}

/**
 * Rejects inputs that cannot fit the model without truncation. Renderer runs
 * it for early feedback; Main and the Agent Utility re-check authoritatively.
 */
export function assertExtrasAgentBudget(
  task:
    | ExtrasAgentResolvedTask
    | Extract<
        ExtrasAgentTask,
        {
          agentId:
            "book-title-design" | "book-synopsis-design" | "book-cover-design";
        }
      >,
  model: ModelCapacity | undefined
): void {
  switch (task.agentId) {
    case "book-title-design":
    case "book-synopsis-design":
    case "book-cover-design":
      if (!model) throw new Error("请选择可用模型。");
      return;
    case "revision-analysis":
      if (!model) throw new Error("请选择可用模型。");
      assertRevisionAnalysisBudget(task.input, task.profile, model);
      return;
    case "short-book-analysis":
      if (!model) throw new Error("请选择可用模型。");
      assertShortAnalysisBudget(task.input, task.profile, model);
      return;
    case "long-book-decomposition":
      if (!model?.contextWindow || model.contextWindow < 16_000)
        throw new Error("请选择窗口至少为 16,000 token 的模型。");
      if (
        task.input.inputBudget >
        Math.floor(
          (model.contextWindow -
            Math.min(model.maxTokens ?? 4096, 8192) -
            3000) *
            0.6
        )
      )
        throw new Error("模型容量与已保存的切分计划不一致。");
      return;
    case "long-book-analysis":
      // The Renderer pipeline sizes each batch to the model before sending it.
      return;
    case "long-material-guide":
      if (
        !model?.contextWindow ||
        model.contextWindow < LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW
      )
        throw new Error("请选择窗口至少为 16,000 token 的模型。");
      if (
        "evidence" in task.input &&
        longMaterialEvidenceTokens(task.input.evidence) >
          longMaterialGuideEvidenceTokens(model)
      )
        throw new Error(
          "素材证据超过所选模型的可用窗口，请换用更大窗口的模型。"
        );
      return;
    case "style-comparison":
      if (model) assertStyleComparisonBudget(task.input, task.profile, model);
      return;
    case "chat-normal":
    case "chat-project":
    case "chat-roleplay":
      // Chat history is bounded by the conversation schema instead.
      return;
  }
}
