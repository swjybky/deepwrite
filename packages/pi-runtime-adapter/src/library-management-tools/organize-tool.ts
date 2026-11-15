import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  MATERIAL_STAGE_IDS,
  type LibraryManagementOrganizeOperation
} from "@deepwrite/contracts";
import { defineTool, textResult } from "../library-agent-tools/shared";
import { libraryIdParameter, resolveEntryIds } from "./read-tools";
import type { LibraryManagementSession } from "./session";

/** Every structure change is reviewed together on one card. */
export function buildLibraryOrganizeTool(
  session: LibraryManagementSession
): AgentTool {
  const libraryId = libraryIdParameter(session);
  return defineTool({
    name: "library_organize",
    label: "整理资料库条目",
    description:
      "整理当前作品绑定库中已保存的条目。delete 删除并保留备份，restore 使用删除提案的 recovery_id 和 entry_ids 恢复。copy 复制完整条目并保留原件，move 移动条目。目标库 target_library_id 默认为本库，须同领域且可写；素材可指定 target_stage_id 换栏目。只读库可以作为复制来源。一次最多 32 项操作，共用一张整理卡，用户接受后执行。请先处理同领域的条目修改卡再接受整理。",
    parameters: Type.Object({
      library_id: libraryId,
      operations: Type.Array(
        Type.Object({
          action: StringEnum(["delete", "restore", "move", "copy"] as const),
          entry_ids: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
            minItems: 1,
            maxItems: 128
          }),
          recovery_id: Type.Optional(
            Type.String({ minLength: 1, maxLength: 512 })
          ),
          target_library_id: Type.Optional(libraryId),
          target_stage_id: Type.Optional(StringEnum(MATERIAL_STAGE_IDS))
        }),
        { minItems: 1, maxItems: 32 }
      )
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      try {
        const library = await session.library(params.library_id, signal);
        const { domain } = library.candidate;
        const operations: LibraryManagementOrganizeOperation[] = [];
        for (const item of params.operations) {
          if (library.candidate.readOnly && item.action !== "copy")
            return textResult("来源库只读，只能复制条目到可写库。");
          const entryIds =
            item.action === "restore"
              ? item.entry_ids
              : resolveEntryIds(library, item.entry_ids, []);
          const pending = library.entries.filter(
            (entry) => entryIds.includes(entry.entryId) && entry.creationId
          );
          if (pending.length)
            return textResult(
              `本轮新建且尚未保存的条目不能整理：${pending.map((entry) => entry.title).join("、")}`
            );
          let operation: LibraryManagementOrganizeOperation;
          if (item.action === "restore") {
            if (!item.recovery_id)
              return textResult("恢复需要删除提案中的 recovery_id。");
            operation = {
              action: "restore-entries",
              libraryId: params.library_id,
              entryIds,
              recoveryId: item.recovery_id
            };
          } else if (item.action === "delete") {
            operation = {
              action: "archive-entries",
              libraryId: params.library_id,
              entryIds
            };
          } else {
            const target = item.target_library_id ?? params.library_id;
            const targetLibrary = session.candidate(target);
            if (targetLibrary.domain !== domain)
              return textResult("来源库和目标库必须属于同一领域。");
            if (targetLibrary.readOnly)
              return textResult("目标库只读，请选择可写的目标库。");
            if (domain === "skill" && item.target_stage_id)
              return textResult("技能条目不支持更换栏目。");
            if (
              item.action === "move" &&
              target === params.library_id &&
              !item.target_stage_id
            )
              return textResult(
                "移动需要不同的 target_library_id 或 target_stage_id。"
              );
            operation = {
              action: item.action === "copy" ? "copy-entries" : "move-entries",
              libraryId: params.library_id,
              entryIds,
              target: { kind: "library", libraryId: target },
              ...(item.target_stage_id
                ? { targetStageId: item.target_stage_id }
                : {})
            };
          }
          operations.push(operation);
        }
        const request = session.structureRequest(domain, operations);
        const { plan } = await session.query(
          domain,
          undefined,
          {
            kind: "preview-structure",
            requestId: request.requestId,
            operations: request.operations
          },
          signal
        );
        if (!plan || plan.domain !== domain)
          throw new Error("整理预览结果与请求不符。");
        return textResult(
          `整理提案等待用户审阅，接受后才会执行。\n${plan.summary}`,
          { kind: "library-structure-mutation", plan }
        );
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  });
}
