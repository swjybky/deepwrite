import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { LongWorkspaceOperation } from "@deepwrite/contracts";
import { defineTool, textResult } from "./shared";
import {
  chapterContextIdParameter,
  contentParameter,
  documentParameter,
  editMetaParameter,
  entityIdParameter,
  explicitTrueParameter,
  strictObject,
  summaryParameter
} from "./schemas";
import { characterMetadataOperations } from "./character-metadata";
import { LONG_STAGE_ROOTS } from "./entity-registry";
import {
  longEntityContentPatch,
  longEntityUpdateOperationType,
  longMetaPatch
} from "./entity-records";
import { formLongProposal } from "./proposals";
import { resolveLongTarget, type LongResolvedTarget } from "./target";
import { longStructureUpdateOperation } from "./structure-operations";
import type { LongToolContext } from "./context";
import { confirmCrossStageWrite, crossStageWriteCancelled } from "./user-input";

interface Replacement {
  original_text: string;
  new_text: string;
}

export function applyReplacements(
  source: string,
  replacements: readonly Replacement[]
): { content: string } | { failure: string } {
  let content = source;
  for (const replacement of replacements) {
    const first = content.indexOf(replacement.original_text);
    const second =
      first < 0
        ? -1
        : content.indexOf(
            replacement.original_text,
            first + replacement.original_text.length
          );
    if (first < 0 || second >= 0) {
      return {
        failure: `未替换：原文片段必须唯一存在：${replacement.original_text.slice(0, 80)}`
      };
    }
    content =
      content.slice(0, first) +
      replacement.new_text +
      content.slice(first + replacement.original_text.length);
  }
  return { content };
}

function requireSingleIntent(params: {
  content?: string;
  replacements?: readonly Replacement[];
  meta?: Record<string, unknown>;
  target: LongResolvedTarget;
}): void {
  const bodyIntents = [
    params.content !== undefined,
    (params.replacements?.length ?? 0) > 0
  ].filter(Boolean).length;
  if (bodyIntents > 1) {
    throw new Error("content 与 replacements 只能二选一。");
  }
  if (bodyIntents === 0 && !params.meta) {
    throw new Error("edit 至少需要 content、replacements 或 meta 其中之一。");
  }
  if (
    params.target.addressing === "document" &&
    params.meta &&
    bodyIntents > 0
  ) {
    throw new Error("文档对象的 meta 修改与正文写入请分成两次调用。");
  }
}

export function buildEditTool(ctx: LongToolContext): AgentTool {
  const {
    writableRoots,
    loadIndex,
    readWholeDocument,
    fullyReadDocuments,
    fullyReadRecords,
    reloadIndex
  } = ctx;
  return defineTool({
    name: "edit",
    label: "修改对象",
    description:
      "修改一个已有对象：目标正文为空时可直接给 content 整篇写入；覆盖已有非空正文必须先 read 完整读取并设置 allow_overwrite_existing=true；局部修改用 replacements 替换完整读取后的唯一原文片段。人物 current_state/history 必须传 chapter_id 才能修改指定章文件，不传时是只读的最新账本映射。meta 用于改标题或关系字段；人物 meta 支持 name、aliases、type_id，type_id 将人物移到已有类型末尾，仅修改人物 meta 时可省略 document。文档对象的 meta 修改要单独调用。",
    parameters: strictObject({
      id: entityIdParameter,
      document: Type.Optional(documentParameter),
      chapter_id: Type.Optional(chapterContextIdParameter),
      content: Type.Optional(contentParameter),
      replacements: Type.Optional(
        Type.Array(
          strictObject({
            original_text: Type.String({ minLength: 1, maxLength: 200_000 }),
            new_text: Type.String({ maxLength: 200_000 })
          }),
          { minItems: 1, maxItems: 100 }
        )
      ),
      meta: Type.Optional(editMetaParameter),
      allow_overwrite_existing: Type.Optional(explicitTrueParameter),
      summary: summaryParameter
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const summary = params.summary.trim();
      if (!summary) throw new Error("summary 必须非空。");
      const document =
        params.document ??
        (params.id.startsWith("character_") &&
        params.meta &&
        params.content === undefined &&
        !params.replacements &&
        !params.chapter_id
          ? "core_profile"
          : undefined);
      let index = await loadIndex(signal);
      let target = resolveLongTarget(index, {
        id: params.id,
        ...(document ? { document } : {}),
        ...(params.chapter_id ? { chapter_id: params.chapter_id } : {})
      });
      if (!writableRoots.has(LONG_STAGE_ROOTS[target.stage])) {
        throw new Error(`当前智能体无权写入 ${target.stage} 阶段。`);
      }
      const decision = await confirmCrossStageWrite(ctx, {
        toolCallId,
        targetStage: target.stage,
        targetTitle: target.title,
        operationLabel: "修改",
        signal
      });
      if (decision === "cancel") {
        return crossStageWriteCancelled(ctx, target.stage);
      }
      if (LONG_STAGE_ROOTS[target.stage] !== ctx.workspace.activeRoot) {
        index = await reloadIndex(signal);
        target = resolveLongTarget(index, {
          id: params.id,
          ...(document ? { document } : {}),
          ...(params.chapter_id ? { chapter_id: params.chapter_id } : {})
        });
        if (!writableRoots.has(LONG_STAGE_ROOTS[target.stage])) {
          throw new Error(`当前智能体无权写入 ${target.stage} 阶段。`);
        }
      }
      requireSingleIntent({ ...params, target });
      const timestamp = new Date().toISOString();

      if (target.addressing === "field") {
        const patch: Record<string, unknown> = params.meta
          ? longMetaPatch(target.kind, params.meta)
          : {};
        if (params.content !== undefined || params.replacements) {
          if (target.content.trim()) {
            const evidence = fullyReadRecords.get(target.id);
            if (evidence === undefined || evidence !== target.content) {
              return textResult(`未修改：请先用 read 完整读取 ${target.id}。`);
            }
            if (
              params.content !== undefined &&
              !params.allow_overwrite_existing
            ) {
              return textResult(
                "未修改：目标已有正文，整篇覆盖需设置 allow_overwrite_existing=true。"
              );
            }
          }
          const next = params.replacements
            ? applyReplacements(target.content, params.replacements)
            : { content: params.content! };
          if ("failure" in next) return textResult(next.failure);
          Object.assign(
            patch,
            longEntityContentPatch(target.record, next.content)
          );
          fullyReadRecords.set(target.id, next.content);
        }
        const operation = {
          type: longEntityUpdateOperationType(target.record.kind),
          id: target.id,
          patch
        } as unknown as LongWorkspaceOperation;
        return formLongProposal(ctx, {
          toolCallId,
          changes: [],
          operations: [operation],
          timestamp,
          summary,
          message: `已形成《${target.title}》修改提案，等待客户端审阅。`,
          index
        });
      }

      if (target.publicId && params.meta) {
        throw new Error("按 chapter_id 定位的人物连续性文档不支持修改 meta。");
      }

      if (params.meta) {
        const characterEdit =
          target.kind === "character"
            ? characterMetadataOperations(index, target.id, params.meta)
            : undefined;
        if (characterEdit?.operations.length === 0)
          return textResult("无需修改：人物信息和类型归属未变化。");
        return formLongProposal(ctx, {
          toolCallId,
          changes: [],
          operations: characterEdit?.operations ?? [
            longStructureUpdateOperation(
              index,
              target,
              longMetaPatch(target.kind, params.meta)
            )
          ],
          timestamp,
          summary: characterEdit?.relocation
            ? `${summary}（${characterEdit.relocation}）`.slice(0, 1_000)
            : summary,
          message: `已形成《${target.title}》信息修改提案，等待客户端审阅。`,
          index
        });
      }

      if (target.readOnly) {
        throw new Error(
          "人物当前状态和历史轨迹映射自最新已提交章节，不能在人物阶段直接修改。"
        );
      }

      const live = await readWholeDocument(target.file, signal);
      const evidence = fullyReadDocuments.get(live.file.id);
      if (live.content.trim()) {
        if (params.content !== undefined && !params.allow_overwrite_existing) {
          return textResult(
            "未写入：目标已有正文，整篇覆盖需设置 allow_overwrite_existing=true。"
          );
        }
        if (!evidence || evidence.content !== live.content) {
          return textResult(`未修改：请先用 read 完整读取 ${target.title}。`);
        }
      }
      const next = params.replacements
        ? applyReplacements(
            evidence?.content ?? live.content,
            params.replacements
          )
        : { content: params.content! };
      if ("failure" in next) return textResult(next.failure);
      if (params.replacements && !evidence) {
        return textResult(`未修改：请先用 read 完整读取 ${target.title}。`);
      }
      fullyReadDocuments.set(live.file.id, {
        content: next.content,
        file: { ...live.file, updatedAt: timestamp }
      });
      return formLongProposal(ctx, {
        toolCallId,
        changes: [
          {
            target,
            operation: params.replacements ? "edit" : "write",
            beforeText: live.content,
            afterText: next.content,
            file: live.file
          }
        ],
        operations: [],
        timestamp,
        summary,
        message: `已形成《${target.title}》正文${
          params.replacements ? "编辑" : "写入"
        }提案，等待客户端审阅。`,
        index
      });
    }
  });
}
