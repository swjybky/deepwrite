import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "./shared";
import {
  chapterContextIdParameter,
  documentParameter,
  entityIdParameter,
  strictObject,
  summaryParameter
} from "./schemas";
import { LONG_ENTITY_KIND_LABELS, LONG_STAGE_ROOTS } from "./entity-registry";
import { resolveLongEntityTarget } from "./entity-target";
import { resolveLongTarget } from "./target";
import {
  longContinuityDeleteOperation,
  longEntityDeleteOperation
} from "./structure-operations";
import { formLongProposal } from "./proposals";
import type { LongToolContext } from "./context";

export function buildDeleteTool(ctx: LongToolContext): AgentTool {
  const { writableRoots, loadIndex, reloadIndex } = ctx;
  return defineTool({
    name: "delete",
    label: "删除对象",
    description:
      "删除一个具体对象。不传 document 时删除对象本身；传 document 时只能删除可选的连续性文件：章卡 world_reveals，或人物 current_state/history 配合 chapter_id 按人物成对删除该章连续性文件。世界观分类、人物类型这类容器不能删除。关联影响会显示在审批卡上，由用户确认后解除引用或删除从属内容。",
    parameters: strictObject({
      id: entityIdParameter,
      document: Type.Optional(documentParameter),
      chapter_id: Type.Optional(chapterContextIdParameter),
      summary: Type.Optional(summaryParameter)
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      let index = await loadIndex(signal);
      const timestamp = new Date().toISOString();

      if (params.document) {
        let target = resolveLongTarget(index, {
          id: params.id,
          document: params.document,
          ...(params.chapter_id ? { chapter_id: params.chapter_id } : {})
        });
        if (target.addressing !== "document") {
          throw new Error("该对象没有可单独删除的文档。");
        }
        if (!writableRoots.has(LONG_STAGE_ROOTS[target.stage])) {
          throw new Error(`当前智能体无权写入 ${target.stage} 阶段。`);
        }
        if (LONG_STAGE_ROOTS[target.stage] !== ctx.workspace.activeRoot) {
          index = await reloadIndex(signal);
          target = resolveLongTarget(index, {
            id: params.id,
            document: params.document,
            ...(params.chapter_id ? { chapter_id: params.chapter_id } : {})
          });
          if (target.addressing !== "document") {
            throw new Error("该对象没有可单独删除的文档。");
          }
          if (!writableRoots.has(LONG_STAGE_ROOTS[target.stage])) {
            throw new Error(`当前智能体无权写入 ${target.stage} 阶段。`);
          }
        }
        const summary = params.summary?.trim() || `删除《${target.title}》`;
        return formLongProposal(ctx, {
          toolCallId,
          changes: [],
          operations: [longContinuityDeleteOperation(target)],
          timestamp,
          summary,
          message: `已形成《${target.title}》删除提案，等待客户端确认关联影响。`,
          review: {
            targetKey: `delete:${target.file.id}`,
            targetKind: "continuity_file",
            targetId: target.id,
            action: "delete",
            title: `删除连续性文件 · ${target.title}`.slice(0, 600)
          },
          index
        });
      }

      let target = resolveLongEntityTarget(index, params.id);
      if (!writableRoots.has(LONG_STAGE_ROOTS[target.stage])) {
        throw new Error(`当前智能体无权写入 ${target.stage} 阶段。`);
      }
      if (LONG_STAGE_ROOTS[target.stage] !== ctx.workspace.activeRoot) {
        index = await reloadIndex(signal);
        target = resolveLongEntityTarget(index, params.id);
        if (!writableRoots.has(LONG_STAGE_ROOTS[target.stage])) {
          throw new Error(`当前智能体无权写入 ${target.stage} 阶段。`);
        }
      }
      const summary = params.summary?.trim() || `删除《${target.title}》`;
      return formLongProposal(ctx, {
        toolCallId,
        changes: [],
        operations: [longEntityDeleteOperation(target)],
        timestamp,
        summary,
        message: `已形成《${target.title}》删除提案，等待客户端确认关联影响。`,
        review: {
          targetKey: `delete:${target.id}`,
          targetKind: target.kind,
          targetId: target.id,
          action: "delete",
          title:
            `删除${LONG_ENTITY_KIND_LABELS[target.kind]} · ${target.title}`.slice(
              0,
              600
            )
        },
        index
      });
    }
  });
}
