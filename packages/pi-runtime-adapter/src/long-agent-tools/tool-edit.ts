import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { LongWorkspaceOperation } from "@deepwrite/contracts";
import {
  WRITING_EDIT_CONTENT_DESCRIPTION,
  WRITING_EDIT_CONTENT_GUIDANCE,
  WRITING_EDIT_OVERWRITE_DESCRIPTION,
  WRITING_EDIT_OVERWRITE_RECOVERY
} from "../writing-edit-guidance";
import {
  resolveWritingEditSummary,
  WRITING_EDIT_SUMMARY_DESCRIPTION
} from "../writing-edit-summary";
import { defineTool, textResult } from "./shared";
import {
  chapterContextIdParameter,
  contentParameter,
  documentParameter,
  editMetaParameter,
  entityIdParameter,
  explicitTrueParameter,
  strictObject
} from "./schemas";
import { characterMetadataOperations } from "./character-metadata";
import { chapterMetadataOperations } from "./chapter-metadata";
import { LONG_STAGE_ROOTS } from "./entity-registry";
import {
  longEntityContentPatch,
  longEntityUpdateOperationType,
  longMetaPatch
} from "./entity-records";
import { formLongProposal } from "./proposals";
import {
  WRITING_CONTENT_COUNT_DESCRIPTION,
  type WritingContentTarget
} from "../writing-content-counts";
import { longRecordContentTarget } from "./content-counts";
import { resolveLongTarget, type LongResolvedTarget } from "./target";
import { longStructureUpdateOperation } from "./structure-operations";
import { volumeChapterOrderOperation } from "./volume-chapter-order";
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
      "修改一个已有对象。" +
      WRITING_EDIT_CONTENT_GUIDANCE +
      "人物 current_state/history 必须传 chapter_id 才能修改指定章文件，不传时是只读的最新账本映射。meta 用于改标题或关系字段；人物 meta 支持 name、aliases、type_id，type_id 将人物移到已有类型末尾。章卡 meta 支持 title、primary_arc_id，primary_arc_id 切换同卷主剧情点，null 解除关联并保持章卡顺序。分卷 meta 支持 title、chapter_order，chapter_order 按新顺序列出本卷全部章卡 id 来调整章节先后，已写入连续性账本的章节位置固定。仅修改人物或章卡 meta 时可省略 document。文档对象的 meta 修改要单独调用。" +
      WRITING_CONTENT_COUNT_DESCRIPTION,
    parameters: strictObject({
      id: entityIdParameter,
      document: Type.Optional(documentParameter),
      chapter_id: Type.Optional(chapterContextIdParameter),
      content: Type.Optional(
        Type.Unsafe<string>({
          ...contentParameter,
          description: WRITING_EDIT_CONTENT_DESCRIPTION
        })
      ),
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
      allow_overwrite_existing: Type.Optional(
        Type.Unsafe<boolean>({
          ...explicitTrueParameter,
          description: WRITING_EDIT_OVERWRITE_DESCRIPTION
        })
      ),
      summary: Type.Optional(
        Type.String({
          maxLength: 1_000,
          description: WRITING_EDIT_SUMMARY_DESCRIPTION
        })
      )
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const document =
        params.document ??
        (params.meta &&
        params.content === undefined &&
        !params.replacements &&
        !params.chapter_id
          ? params.id.startsWith("character_")
            ? "core_profile"
            : params.id.startsWith("chapter_")
              ? "card"
              : undefined
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
      const summary = resolveWritingEditSummary(
        params.summary,
        target.title,
        params
      );
      const timestamp = new Date().toISOString();

      if (target.addressing === "field") {
        const contentTargets: WritingContentTarget[] = [];
        const { chapter_order: chapterOrder, ...recordMeta } =
          params.meta ?? {};
        const reorder = chapterOrder
          ? volumeChapterOrderOperation(index, target, chapterOrder)
          : undefined;
        const patch: Record<string, unknown> = longMetaPatch(
          target.kind,
          recordMeta
        );
        if (params.content !== undefined || params.replacements) {
          if (target.content.trim()) {
            const evidence = fullyReadRecords.get(target.id);
            if (evidence === undefined || evidence !== target.content) {
              return textResult(`未修改：请先用 read 完整读取 ${target.id}。`);
            }
            if (
              params.content !== undefined &&
              params.allow_overwrite_existing !== true
            ) {
              return textResult(WRITING_EDIT_OVERWRITE_RECOVERY);
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
          contentTargets.push(
            longRecordContentTarget(
              target.kind,
              target.id,
              target.title,
              next.content
            )
          );
        }
        const operations = [
          ...(Object.keys(patch).length > 0
            ? [
                {
                  type: longEntityUpdateOperationType(target.record.kind),
                  id: target.id,
                  patch
                } as unknown as LongWorkspaceOperation
              ]
            : []),
          ...(reorder ? [reorder.operation] : [])
        ];
        if (operations.length === 0) {
          return textResult("无需修改：本卷章节顺序未变化。");
        }
        return formLongProposal(ctx, {
          toolCallId,
          changes: [],
          operations,
          timestamp,
          summary: reorder
            ? `${summary}（${reorder.relocation}）`.slice(0, 1_000)
            : summary,
          message: `已形成《${target.title}》修改提案，等待客户端审阅。`,
          contentTargets,
          index
        });
      }

      if (target.publicId && params.meta) {
        throw new Error("按 chapter_id 定位的人物连续性文档不支持修改 meta。");
      }

      if (params.meta) {
        const metadataEdit =
          target.kind === "character"
            ? characterMetadataOperations(index, target.id, params.meta)
            : target.kind === "chapter_card"
              ? chapterMetadataOperations(index, target.id, params.meta)
              : undefined;
        if (metadataEdit?.operations.length === 0)
          return textResult(
            target.kind === "character"
              ? "无需修改：人物信息和类型归属未变化。"
              : "无需修改：章卡标题和主剧情点未变化。"
          );
        return formLongProposal(ctx, {
          toolCallId,
          changes: [],
          operations: metadataEdit?.operations ?? [
            longStructureUpdateOperation(
              index,
              target,
              longMetaPatch(target.kind, params.meta)
            )
          ],
          timestamp,
          summary: metadataEdit?.relocation
            ? `${summary}（${metadataEdit.relocation}）`.slice(0, 1_000)
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
        if (
          params.content !== undefined &&
          params.allow_overwrite_existing !== true
        ) {
          return textResult(WRITING_EDIT_OVERWRITE_RECOVERY);
        }
        if (!evidence) {
          return textResult(`未修改：请先用 read 完整读取 ${target.title}。`);
        }
        if (evidence.content !== live.content) {
          // Editing stays open during runs, so this is usually the user.
          return textResult(
            `未修改：${target.title} 在你读取后已有改动（可能是用户正在编辑），请先用 read 完整读取最新内容再修改。`
          );
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
