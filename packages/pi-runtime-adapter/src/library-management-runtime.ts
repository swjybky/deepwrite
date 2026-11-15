import {
  LIBRARY_MANAGEMENT_INVOCATION_POLICY,
  MATERIAL_METADATA_AUTHORING_GUIDANCE,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { buildLibraryOrganizeTool } from "./library-management-tools/organize-tool";
import { buildLibraryReadTools } from "./library-management-tools/read-tools";
import { LibraryManagementSession } from "./library-management-tools/session";
import { buildLibraryWriteTool } from "./library-management-tools/write-tool";
import type { AgentRunInput } from "./runtime-types";

export type LibraryManagementCommandExecutor = (
  command: Extract<CommandEnvelope, { type: "catalog.queryLibraryManagement" }>,
  signal?: AbortSignal
) => Promise<CommandResult>;

const DOMAIN_NAME = { material: "素材库", skill: "技能库" } as const;

export function libraryManagementParentPrompt(input: AgentRunInput): string {
  const context = input.libraryManagement;
  if (!context?.managers.length) return "";
  const domains = new Set(context.managers.map((manager) => manager.domain));
  const libraries = context.libraries.filter((library) =>
    domains.has(library.domain)
  );
  return [
    "【内置资料库管理工具】",
    LIBRARY_MANAGEMENT_INVOCATION_POLICY,
    ...context.managers.map(
      (manager) => `${DOMAIN_NAME[manager.domain]}管理：${manager.description}`
    ),
    "工具：library_list 看已绑定库与目录，library_read 读全文（一次最多 10 条），library_search 跨库搜索，library_write 批量新建或修改条目与库介绍，library_organize 复制、移动、删除或恢复条目。读写与整理用 library_id 指定库，列表和搜索可以省略 library_id。只读库可以作为复制来源，写入目标须可写。",
    "一次要记录或修改多条时，放进同一个 library_write 调用；新建后还要修改，直接在 create 里给出最终正文。",
    ...(domains.has("material") ? [MATERIAL_METADATA_AUTHORING_GUIDANCE] : []),
    ...(libraries.length
      ? [
          "已绑定的候选库：",
          ...libraries.map(
            (library) =>
              `- ${DOMAIN_NAME[library.domain]} / ${library.libraryId}：${library.title}${library.readOnly ? "（只读）" : ""}`
          )
        ]
      : ["当前没有已绑定的资料库，请告知用户先绑定目标库。"])
  ].join("\n");
}

export function createLibraryManagementRuntime(input: AgentRunInput) {
  if (!input.libraryManagement?.managers.length) return { tools: [] };
  const session = new LibraryManagementSession(input);
  return {
    reset: () => session.reset(),
    tools: [
      ...buildLibraryReadTools(session),
      buildLibraryWriteTool(session),
      buildLibraryOrganizeTool(session)
    ]
  };
}
