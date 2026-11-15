import { randomUUID } from "node:crypto";
import {
  CatalogQueryMaterialsCommandEnvelopeSchema,
  MaterialQueryResultSchema,
  createEnvelope,
  type CatalogQueryMaterialsCommand,
  type CommandResult,
  type MaterialCatalogContext
} from "@deepwrite/contracts";
import type { AgentRunInput } from "./runtime-types";
import { materialIndexLine, type MaterialQuery } from "./material-catalog";

export type MaterialCommandExecutor = (
  command: CatalogQueryMaterialsCommand,
  signal?: AbortSignal
) => Promise<CommandResult>;
export type MaterialQueryRunner = (
  params: MaterialQuery,
  kinds: readonly string[],
  signal?: AbortSignal
) => Promise<string>;

export function materialCatalogEntries(context: MaterialCatalogContext) {
  return context.entries.map((entry) => ({
    ...entry,
    source: "attached-material" as const,
    content: ""
  }));
}

export function createMaterialQueryRunner(
  input: AgentRunInput
): MaterialQueryRunner | undefined {
  const catalog = input.workspaceContext?.materialCatalog;
  const executor = input.materialCommandExecutor;
  if (!catalog || !executor) return undefined;
  const english = input.promptLocale === "en-US";
  const revisions = new Map(
    catalog.entries.map((entry) => [entry.id, entry.revision])
  );
  return async (params, kinds, signal) => {
    const scope = {
      ...catalog.scope,
      kinds: catalog.scope.kinds.filter((kind) => kinds.includes(kind))
    };
    const expected = params.entry_id
      ? revisions.get(params.entry_id)
      : undefined;
    const command = CatalogQueryMaterialsCommandEnvelopeSchema.parse(
      createEnvelope(
        "catalog.queryMaterials",
        {
          ...params,
          scope,
          limit: 32,
          ...(expected ? { expected_revision: expected } : {})
        },
        {
          id: `material-query:${randomUUID()}`,
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: scope.bookId
          }
        }
      )
    );
    const response = await executor(command, signal);
    if (response.status !== "accepted") throw new Error(response.error.message);
    const result = MaterialQueryResultSchema.parse(response.payload);
    for (const entry of result.entries) revisions.set(entry.id, entry.revision);
    if (result.status === "not_found")
      return english
        ? "No currently linked, readable material found. Refresh the directory."
        : "没有找到当前仍关联且可读取的素材；请刷新目录。";
    if (params.mode === "read" && result.status === "ok") {
      const item = result.entries[0];
      if (!item || result.content === undefined)
        throw new Error(
          english
            ? "The material read returned no source text. Retry the read."
            : "素材读取结果缺少原文，请重试。"
        );
      return [
        ...(result.revisionChanged
          ? [
              english
                ? "The material changed after indexing. The latest source text follows."
                : "素材已在目录生成后更新，以下为最新原文。"
            ]
          : []),
        `【${item.title}】（${item.kind}，id=${item.id}，revision=${item.revision}）`,
        result.content,
        ...result.notices
      ].join("\n\n");
    }
    return [
      result.status === "ambiguous"
        ? english
          ? "Multiple materials match. Use entry_id."
          : "匹配到多个素材条目，请改用稳定 id（entry_id）。"
        : english
          ? `${result.total} readable materials found.`
          : `找到 ${result.total} 条可读素材。`,
      ...result.entries.map((entry) =>
        [
          materialIndexLine(
            {
              ...entry,
              source: "attached-material",
              content: ""
            },
            160,
            english
          ),
          ...(entry.matchSnippet
            ? [`  ${english ? "Match: " : "命中片段："}${entry.matchSnippet}`]
            : [])
        ].join("\n")
      ),
      ...(result.nextCursor !== undefined
        ? [
            english
              ? `Continue with cursor=${result.nextCursor}.`
              : `更多结果：使用相同查询参数并传 cursor=${result.nextCursor} 继续。`
          ]
        : []),
      ...result.notices
    ].join("\n");
  };
}
