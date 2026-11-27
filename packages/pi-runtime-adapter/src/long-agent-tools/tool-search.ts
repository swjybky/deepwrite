import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import {
  LongSearchCommandEnvelopeSchema,
  LongSearchResultSchema,
  createEnvelope
} from "@deepwrite/contracts";
import { strictObject, stageParameter } from "./schemas";
import { LONG_STAGE_ROOTS, type LongStage } from "./entity-registry";
import { defineTool, textResult } from "./shared";
import type { LongToolContext } from "./context";
import { longSearchTargets } from "./search-targets";

export function buildSearchTool(ctx: LongToolContext): AgentTool {
  let sequence = 0;
  return defineTool({
    name: "search",
    label: "检索作品全文",
    description:
      "检索当前长篇的已保存文本，返回业务 id、文档类型和片段。stage 可选，默认检索全书；读取权限受限时须指定有权限的 stage。cursor 用于继续。命中片段不等于完整读取，修改前仍须 read 全文。",
    parameters: strictObject({
      query: Type.String({ description: "检索词，1–256个字符。" }),
      stage: Type.Optional(stageParameter),
      cursor: Type.Optional(Type.String())
    }),
    execute: async (_id, params, signal) => {
      const query = params.query.trim();
      if (!query || query.length > 256)
        throw new Error("query 必须包含1–256个字符。");
      const stage = params.stage as LongStage | undefined;
      if (stage && !ctx.readableRoots.has(LONG_STAGE_ROOTS[stage]))
        throw new Error(`当前智能体无权读取 ${stage} 阶段。`);
      if (!stage && ctx.readableRoots.size !== 5)
        throw new Error("读取权限受限时，请指定有权限的 stage。");
      const scope = stage ? LONG_STAGE_ROOTS[stage] : "all";
      const command = LongSearchCommandEnvelopeSchema.parse(
        createEnvelope(
          "long.search",
          {
            bookId: ctx.workspace.bookId,
            query,
            scope,
            ...(params.cursor ? { cursor: params.cursor } : {})
          },
          {
            id: `long-query-${ctx.input.runId}-c${ctx.contextId}-search-${++sequence}`,
            context: {
              sessionId: ctx.input.sessionId,
              runId: ctx.input.runId,
              resourceId: ctx.workspace.bookId
            }
          }
        )
      );
      const result = LongSearchResultSchema.parse(
        await ctx.execute(command, signal)
      );
      if (
        result.bookId !== ctx.workspace.bookId ||
        result.query !== query.normalize("NFC") ||
        result.scope !== scope
      )
        throw new Error("Core returned a different long search.");
      const targets = longSearchTargets(await ctx.reloadIndex(signal));
      const hits = result.hits.flatMap((hit) => {
        const target = targets.get(hit.fileId);
        if (!target || !ctx.readableRoots.has(hit.root)) return [];
        return [
          `- ${hit.title}（${Object.entries(target)
            .map(([key, value]) => `${key}=${value}`)
            .join("；")}）\n  ${hit.snippet}`
        ];
      });
      return textResult(
        [
          `检索 ${JSON.stringify(query)}，命中 ${hits.length} 条。检索片段不等于已读，修改前须 read 全文。`,
          ...hits,
          result.nextCursor
            ? `下一页 cursor=${result.nextCursor}`
            : "已检索完毕。"
        ].join("\n")
      );
    }
  });
}
