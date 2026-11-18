import { assertWritingDocumentAvailable } from "./settlement";
import {
  resolveWritingEditSummary,
  WRITING_EDIT_SUMMARY_DESCRIPTION
} from "../writing-edit-summary";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  overwriteModeParameter,
  REPLACE_ALL_OVERWRITE_MODE,
  WRITING_EDIT_CONTENT_DESCRIPTION,
  WRITING_EDIT_OVERWRITE_DESCRIPTION,
  WRITING_EDIT_OVERWRITE_RECOVERY
} from "../writing-edit-guidance";
import { WRITING_CONTENT_COUNT_DESCRIPTION } from "../writing-content-counts";
import { defineTool, literalUnion } from "./schema";
import {
  replaceText,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import { writingParameters } from "./tool-parameters";
import { formShortMetaProposal } from "./unified-edit-meta";
import { formShortContentProposal } from "./unified-proposal";
import {
  hasCurrentReadEvidence,
  type ShortUnifiedReadState
} from "./unified-read-tool";
import {
  assertWritableTarget,
  resolveShortUnifiedTarget,
  resolveWritingEditKind
} from "./unified-target";

export function buildShortUnifiedEditTool(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState
): AgentTool {
  const {
    stableWritingIdParameter,
    writingContentParameter,
    writingDocumentParameter,
    writingEditKindParameter,
    writingEditMetaParameter
  } = writingParameters(input);
  return defineTool({
    name: "edit",
    label:
      input.promptLocale === "en-US"
        ? `Edit ${input.workspaceType === "script" ? "screenplay" : "short-fiction"} object`
        : `修改${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description:
      (input.promptLocale === "en-US"
        ? "Edit an existing object. Always supply kind and stable id. Choose exactly one of content (full text), replacements (unique local passages), append (exact suffix), insert (before/after a unique anchor), or meta (supported structural fields). draft_section file edits require document=body or state (State). Renames use meta.title without document or content. Use meta.move for cards or manuscript entries; for draft_section, meta.after_id sets an exact position and meta.word_count_requirement updates or clears the length target. Changes to global plot titles/descriptions affect all short-fiction and screenplay works and require confirmation."
        : "修改已有对象。显式提供 kind 和稳定 id。content、replacements、append（原样续写）、insert（在唯一锚点前后插入）、meta 只能选择一种。修改小节或剧集的正文或状态时必须指定 document；改名只传 meta.title。人物、小节或剧集可用 meta.move 上下移动，小节或剧集还可用 meta.after_id 定位，或用 meta.word_count_requirement 设置或清空篇幅要求。剧情结构的标题与说明由所有短篇和剧本共用，修改需要用户确认。") +
      (input.promptLocale === "en-US"
        ? " Proposal counts exclude whitespace and do not confirm a save."
        : WRITING_CONTENT_COUNT_DESCRIPTION),
    parameters: Type.Object(
      {
        kind: Type.Optional(writingEditKindParameter),
        id: stableWritingIdParameter,
        document: Type.Optional(writingDocumentParameter),
        content: Type.Optional(
          Type.Unsafe<string>({
            ...writingContentParameter,
            description:
              input.promptLocale === "en-US"
                ? 'Full replacement text. To clear, use content="". For non-empty targets, first read the complete file and set overwrite_mode=replace_all. Use replacements for local edits.'
                : WRITING_EDIT_CONTENT_DESCRIPTION
          })
        ),
        append: Type.Optional(
          Type.String({
            ...writingContentParameter,
            description:
              input.promptLocale === "en-US"
                ? "Text to append verbatim, including any desired newline."
                : "原样追加的文本，需要换行时显式写入换行符。"
          })
        ),
        insert: Type.Optional(
          Type.Object(
            {
              anchor: Type.String({ minLength: 1, maxLength: 200_000 }),
              position: literalUnion(["before", "after"] as const),
              text: writingContentParameter
            },
            { additionalProperties: false }
          )
        ),
        replacements: Type.Optional(
          Type.Array(
            Type.Object(
              {
                original_text: Type.String({
                  minLength: 1,
                  maxLength: 200_000
                }),
                new_text: Type.String({ maxLength: 200_000 })
              },
              { additionalProperties: false }
            ),
            { minItems: 1, maxItems: 100 }
          )
        ),
        meta: Type.Optional(writingEditMetaParameter),
        overwrite_mode: overwriteModeParameter(
          input.promptLocale === "en-US"
            ? "Set replace_all with content after a full read when the user asks to replace or clear existing text. Omit for blank targets and local edits."
            : WRITING_EDIT_OVERWRITE_DESCRIPTION
        ),
        summary: Type.Optional(
          Type.String({
            maxLength: 1_000,
            description:
              input.promptLocale === "en-US"
                ? "Optional change summary shown on the approval card."
                : WRITING_EDIT_SUMMARY_DESCRIPTION
          })
        )
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      assertWritingDocumentAvailable(input, state, "");
      const callInput = { ...input, mutationToolCallId: toolCallId };
      const kind = resolveWritingEditKind(input, state, params);
      if (kind === "draft_section" && !params.document && !params.meta) {
        throw new Error(
          input.promptLocale === "en-US"
            ? "Editing draft_section text requires document=body or state."
            : "修改 draft_section 正文时必须指定 document=body 或 state。"
        );
      }
      const target = resolveShortUnifiedTarget(callInput, state, {
        kind,
        id: String(params.id),
        ...(params.document ? { document: params.document } : {})
      });
      assertWritingDocumentAvailable(input, state, target.documentId);
      assertWritableTarget(callInput, target);
      const intentCount =
        Number(params.content !== undefined) +
        Number(Boolean(params.replacements?.length)) +
        Number(params.append !== undefined) +
        Number(params.insert !== undefined) +
        Number(params.meta !== undefined);
      if (intentCount !== 1) {
        throw new Error(
          input.promptLocale === "en-US"
            ? "edit requires exactly one of content, replacements, append, insert or meta."
            : "edit 必须且只能选择 content、replacements、append、insert 或 meta。"
        );
      }
      const summary = resolveWritingEditSummary(
        params.summary,
        target.title,
        params,
        input.promptLocale
      );
      if (params.meta) {
        return formShortMetaProposal(
          callInput,
          state,
          target,
          params.meta,
          summary,
          { toolCallId, ...(signal ? { signal } : {}) }
        );
      }

      const saved = state.coreFiles?.get(target.documentId);
      const previous = readState.fullyRead.get(target.documentId);
      if (
        state.coreFiles &&
        previous &&
        !hasCurrentReadEvidence(readState, target)
      )
        return textResult(
          input.promptLocale === "en-US"
            ? "Not changed: the saved file changed. Read it again before editing."
            : "未修改：已保存的文档发生了变化，请重新读取后再修改。"
        );
      if (
        saved?.revision === target.revision &&
        saved.length > target.content.length
      )
        return textResult(
          input.promptLocale === "en-US"
            ? "Not changed: the file exceeds the full-read limit."
            : "未修改：此文件超过完整读取上限。"
        );
      if (target.content.trim() && !hasCurrentReadEvidence(readState, target)) {
        return textResult(
          input.promptLocale === "en-US"
            ? `Not changed: first read “${target.title}” in full.`
            : `未修改：请先用 read 完整读取「${target.title}」。`
        );
      }
      if (params.content !== undefined) {
        if (
          target.content.trim() &&
          params.overwrite_mode !== REPLACE_ALL_OVERWRITE_MODE
        ) {
          return textResult(
            input.promptLocale === "en-US"
              ? "Not changed: to replace existing text, read the full file and set overwrite_mode=replace_all. For local edits use replacements."
              : WRITING_EDIT_OVERWRITE_RECOVERY
          );
        }
        return formShortContentProposal(
          callInput,
          state,
          readState,
          target,
          String(params.content),
          summary
        );
      }

      if (params.append !== undefined)
        return formShortContentProposal(
          callInput,
          state,
          readState,
          target,
          target.content + params.append,
          summary
        );

      const insert = params.insert;
      const replacements = insert
        ? [
            {
              original_text: insert.anchor,
              new_text:
                insert.position === "before"
                  ? insert.text + insert.anchor
                  : insert.anchor + insert.text
            }
          ]
        : params.replacements!;
      const replaced = replaceText(input, target.content, replacements);
      if (replaced.error || replaced.next === undefined) {
        return textResult(
          input.promptLocale === "en-US"
            ? `Not changed: ${replaced.error ?? "Unknown error"}`
            : `未修改：${replaced.error ?? "未知错误"}`
        );
      }
      return formShortContentProposal(
        callInput,
        state,
        readState,
        target,
        replaced.next,
        summary
      );
    }
  });
}
