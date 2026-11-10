import { Type } from "@earendil-works/pi-ai";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  LibraryStructurePlanSchema,
  LibraryStructureOperationSchema,
  libraryStructureOperationJsonSchema,
  type LibraryStructureOperation
} from "@deepwrite/contracts";
import { defineTool, textResult } from "./shared";
import type { BuildLibraryAgentToolsInput } from "./types";
import type { AgentRunInput } from "../runtime-types";

// PI gateways require singleton enums instead of JSON Schema const literals.
function portableSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableSchema);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "$schema") continue;
    if (key === "const") result.enum = [item];
    else result[key] = portableSchema(item);
  }
  return result;
}

const definitions: {
  name: string;
  label: string;
  actions: LibraryStructureOperation["action"][];
}[] = [
  {
    name: "manage_library",
    label: "管理库",
    actions: [
      "create-library",
      "rename-library",
      "reorder-library",
      "delete-library"
    ]
  },
  {
    name: "manage_group",
    label: "管理分组",
    actions: [
      "create-group",
      "rename-group",
      "set-members",
      "reorder-group",
      "dissolve-group",
      "delete-group"
    ]
  },
  {
    name: "organize_entries",
    label: "整理条目",
    actions: ["move-entries", "reorder-entry", "delete-entries"]
  }
];

/** Only mounted for the domain's library agent, never for work-scoped managers. */
export function buildLibraryStructureTools(
  input: BuildLibraryAgentToolsInput,
  run: AgentRunInput
) {
  let pending: LibraryStructureOperation[] = [];
  async function propose(
    _id: string,
    raw: LibraryStructureOperation[],
    signal?: AbortSignal
  ) {
    try {
      if (!run.libraryAgentCommandExecutor)
        throw new Error("资料库管理服务不可用。");
      const operations = raw.map((operation) =>
        LibraryStructureOperationSchema.parse(operation)
      );
      const next = [...pending, ...operations];
      if (next.length > 32)
        throw new Error("本轮整理超过 32 项，请先审阅已有提案，再分批继续。");
      const command = CommandEnvelopeSchema.parse(
        createEnvelope(
          "catalog.previewLibraryStructure",
          {
            domain: input.workspace.domain,
            requestId: `library-structure:${run.runId}`,
            operations: next
          },
          {
            id: `library-preview:${run.runId}:${_id}`,
            context: { sessionId: run.sessionId, runId: run.runId }
          }
        )
      );
      if (command.type !== "catalog.previewLibraryStructure")
        throw new Error("Invalid command.");
      const result = await run.libraryAgentCommandExecutor(command, signal);
      if (result.status !== "accepted") throw new Error(result.error.message);
      const plan = LibraryStructurePlanSchema.parse(result.payload);
      if (plan.domain !== input.workspace.domain)
        throw new Error("整理结果领域不符。");
      pending = next;
      return textResult(`待用户接受：\n${plan.summary}`, {
        kind: "library-structure-mutation",
        plan
      });
    } catch (error) {
      return textResult(error instanceof Error ? error.message : String(error));
    }
  }
  const tools = definitions.map(({ name, label, actions }) =>
    defineTool({
      name,
      label,
      executionMode: "sequential",
      description: `${label}：先查询索引获取稳定 id。操作生成待用户接受的整理提案，不立即落盘。同轮操作合并审阅，最多 32 项。新建 ref 可供后续操作引用；不可跨领域或修改内置库。解散保留成员，移除库保留本地文件，删除条目及其正文文件无法恢复；delete-group 必须明确 includeLibraries。不要声称提案已经执行。`,
      parameters: Type.Object({
        operations: Type.Array(
          Type.Unsafe<LibraryStructureOperation>(
            portableSchema(
              libraryStructureOperationJsonSchema(actions)
            ) as Record<string, unknown>
          ),
          { minItems: 1, maxItems: 32 }
        )
      }),
      execute: async (id, params, signal) => {
        if (
          params.operations.some(
            (operation) => !actions.includes(operation.action)
          )
        )
          return textResult("操作不属于此工具。");
        return propose(id, params.operations, signal);
      }
    })
  );
  return { tools, propose };
}
