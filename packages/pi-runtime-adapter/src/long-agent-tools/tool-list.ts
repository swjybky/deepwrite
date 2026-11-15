import type { AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, textResult } from "./shared";
import { listScopeIdParameter, stageParameter, strictObject } from "./schemas";
import { LONG_STAGE_ROOTS, type LongStage } from "./entity-registry";
import type { LongToolContext } from "./context";
import { continuityScopeLines, draftScopeLines } from "./list-draft-continuity";
import { plotScopeLines } from "./list-plot";
import {
  characterScopeLines,
  worldbuildingScopeLines
} from "./list-world-character";

export function buildListTool(ctx: LongToolContext): AgentTool {
  const { readableRoots, loadIndex } = ctx;
  return defineTool({
    name: "list",
    label: "列出范围细节",
    description:
      "列出已知容器的二层结构（业务 id、标题、关系，不含正文）。scope_id 必填，默认按 id 推断：world_=世界观；人物类型 id=人物；book_line / volume_ / arc_ / chapter_ / event_ / foreshadow_=剧情。连续性用 view=continuity，book_line 返回全书连续性概览，其他容器为 volume_ / chapter_ / character_。stage 为兼容旧调用保留，draft 是卷/剧情点视图的旧别名；仅有正文读取权限时仍返回正文目录。",
    parameters: strictObject({
      stage: Type.Optional(stageParameter),
      view: Type.Optional(StringEnum(["continuity"] as const)),
      scope_id: listScopeIdParameter
    }),
    execute: async (_toolCallId, params, signal) => {
      const scopeId = params.scope_id;
      if (!scopeId) {
        throw new Error(
          "list 必须提供 scope_id；阶段最上层目录已在当前上下文中传输。"
        );
      }
      if (params.view && params.stage && params.stage !== "continuity") {
        throw new Error("view=continuity 不能与其它 stage 同时使用。");
      }
      const index = await loadIndex(signal);
      const inferred: LongStage =
        scopeId.startsWith("world_") || scopeId.startsWith("worlditem_")
          ? "worldbuilding"
          : index.characterTypes.some(({ id }) => id === scopeId) ||
              scopeId.startsWith("chartype_") ||
              scopeId === "character_overview" ||
              scopeId.startsWith("character_")
            ? "character"
            : "plot";
      const stage =
        params.view === "continuity"
          ? "continuity"
          : ((params.stage as LongStage | undefined) ?? inferred);
      if (!readableRoots.has(LONG_STAGE_ROOTS[stage])) {
        throw new Error(`当前智能体无权读取 ${stage} 阶段。`);
      }
      const lines =
        stage === "worldbuilding"
          ? worldbuildingScopeLines(index, scopeId)
          : stage === "character"
            ? characterScopeLines(index, scopeId)
            : stage === "plot"
              ? plotScopeLines(index, scopeId)
              : stage === "draft"
                ? readableRoots.has("plot_design") &&
                  (scopeId.startsWith("volume_") || scopeId.startsWith("arc_"))
                  ? plotScopeLines(index, scopeId)
                  : draftScopeLines(index, scopeId)
                : continuityScopeLines(index, scopeId);
      return textResult(lines.join("\n"));
    }
  });
}
