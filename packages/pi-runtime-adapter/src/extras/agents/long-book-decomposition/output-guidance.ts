import {
  decompositionBatchLimit,
  decompositionCallOutputTokens,
  decompositionChaptersPerSubmission,
  decompositionProseCharacters,
  type DecompositionModelCapacity
} from "@deepwrite/contracts";
import type { DecompositionRole } from "./roles";

/**
 * A child's share of one response in its own terms — items per call and
 * prose length — from the phase model's configured output limit and thinking
 * level. A batch that does not fit is cut off and saves nothing, so every
 * model gets limits it can actually send.
 */
export function decompositionOutputGuidance(
  role: DecompositionRole,
  model: DecompositionModelCapacity,
  unitIds: readonly string[]
): string {
  const tokens = decompositionCallOutputTokens(model);
  const prose = decompositionProseCharacters(model);
  const batch = (item: Parameters<typeof decompositionBatchLimit>[1]) =>
    decompositionBatchLimit(model, item);
  const perCall = `每次调用提交的内容合计不超过约 ${prose} 字，超过就分几次调用。`;
  const rules: Record<DecompositionRole, string> = {
    reader: `每次最多提交 ${decompositionChaptersPerSubmission(model)} 章，每章记录约 ${Math.min(prose, 3000)} 字以内。`,
    registrar: unitIds.includes("registry:merge")
      ? "只对候选簇给出决定，一次提交。"
      : "本分片的计划一次提交，只写需要的决定，不要罗列无需处理的编号。",
    chronicler: `${perCall}剧情点多时分批：每批最多 ${Math.max(5, Math.floor(prose / 300))} 个，前几批带 batch_mode=partial，summary 放在最后一批。`,
    plot_architect: `${perCall}伏笔线每批最多 ${batch("foreshadowingLine")} 条，超过就分批：前几批带 batch_mode=partial，最后一批不带；分卷多时主线同样分批，前几批只交 volumes，content 与 gimmick 放在最后一批。`,
    character_archivist: perCall,
    world_archivist: `${perCall}设定条目每批最多 ${batch("worldItem")} 条，超过就分批：前几批带 batch_mode=partial，overview 放在最后一批。`,
    style_analyst: `content 不超过约 ${Math.floor(prose / 2)} 字，典型片段最多 ${Math.min(100, batch("styleExcerpt"))} 条。`,
    continuity_keeper: perCall,
    reviewer: `问题最多 ${Math.min(1000, batch("reviewIssue"))} 条，按严重程度取舍。`,
    generalist: perCall
  };
  return [
    `单次回复的可见输出约 ${tokens} token（含工具参数），思考与它共用模型的单次上限；超出会被截断且什么都不保存。思考保持简短，不要在思考里预写成品。`,
    rules[role]
  ].join("");
}
