import { assertWritingDocumentAvailable } from "./settlement";
import { trackWritingMutation } from "./settlement";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { isProvisionalExpertDraftSectionId } from "@deepwrite/contracts";
import { Type } from "typebox";
import { defineTool, literalUnion } from "./schema";
import {
  draftUnitLabel,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import { writingParameters } from "./tool-parameters";
import { shortProposalSummary } from "./unified-proposal";
import {
  resolveShortUnifiedTarget,
  type ShortUnifiedTarget
} from "./unified-target";

function defaultDeleteSummary(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget
): string {
  if (target.kind === "character") {
    return input.promptLocale === "en-US"
      ? `Delete character “${target.title}” and its file`
      : `删除人物条目《${target.title}》及其文件`;
  }
  const section = state.expertSections.get(target.sectionId!);
  return input.promptLocale === "en-US"
    ? `Delete ${draftUnitLabel(input)} “${section?.title ?? target.title}” and its body and State files`
    : `删除${draftUnitLabel(input)}《${section?.title ?? target.title}》及其正文与状态文件`;
}

function deleteCharacterItemProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  rawSummary: string
) {
  return trackWritingMutation(input, state, () => {
    const item = state.characterItems.get(target.itemId!);
    if (!item)
      throw new Error(
        input.promptLocale === "en-US"
          ? `Character ${target.id} was not found. Read kind=workspace, id=workspace for current ids.`
          : `不存在人物条目 ${target.id}。请用 read（kind=workspace，id=workspace）查询最新 id。`
      );
    if (item.provisional) {
      throw new Error(
        input.promptLocale === "en-US"
          ? "This character has not been saved. Accept or reject its creation proposal first."
          : "待创建人物条目尚未落盘，请先完成或撤销创建提案。"
      );
    }
    state.characterItems.delete(item.id);
    state.characterItemOrder = state.characterItemOrder.filter(
      (itemId) => itemId !== item.id
    );
    const summary = rawSummary.trim();
    return textResult(shortProposalSummary(input, summary), {
      kind: "workspace-character-structure-mutation",
      workspaceId: input.workspace.id,
      stageId: "character_design",
      mutation: {
        type: "deleteItem",
        itemId: item.id,
        title: item.title,
        deletedText: item.content
      },
      baseRevision: state.stageRevisions.get("character_design")!,
      summary
    });
  });
}

function deleteDraftSectionProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  rawSummary: string
) {
  return trackWritingMutation(input, state, () => {
    const sectionId = target.sectionId!;
    const section = state.expertSections.get(sectionId);
    if (!section) {
      throw new Error(
        input.promptLocale === "en-US"
          ? `The ${draftUnitLabel(input)} ${sectionId} was not found. Read kind=workspace, id=workspace for current ids.`
          : `不存在${draftUnitLabel(input)} ${sectionId}。请用 read（kind=workspace，id=workspace）查询最新 id。`
      );
    }
    if (isProvisionalExpertDraftSectionId(section.id)) {
      throw new Error(
        input.promptLocale === "en-US"
          ? `This ${draftUnitLabel(input)} has not been saved. Accept or reject its creation proposal first.`
          : `待创建${draftUnitLabel(input)}尚未落盘，请先完成或撤销创建提案。`
      );
    }
    if (state.expertSectionOrder.length <= 1) {
      return textResult(
        input.promptLocale === "en-US"
          ? `Not changed: the manuscript must keep at least one ${draftUnitLabel(input)}.`
          : `未修改：正文至少需要保留一个${draftUnitLabel(input)}。`
      );
    }
    state.expertSections.delete(section.id);
    state.expertSectionOrder = state.expertSectionOrder.filter(
      (candidate) => candidate !== section.id
    );
    const summary = rawSummary.trim();
    return textResult(shortProposalSummary(input, summary), {
      kind: "workspace-expert-draft-section-deletion",
      workspaceId: input.workspace.id,
      stageId: "draft",
      sectionId: section.id,
      title: section.title,
      baseRevision: state.expertDraftDirectoryBaseRevision,
      summary
    });
  });
}

export function buildShortUnifiedDeleteTool(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState
): AgentTool {
  const { stableWritingIdParameter, writingSummaryParameter } =
    writingParameters(input);
  return defineTool({
    name: "delete",
    label:
      input.promptLocale === "en-US"
        ? `Delete ${input.workspaceType === "script" ? "screenplay" : "short-fiction"} object`
        : `删除${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description:
      input.promptLocale === "en-US"
        ? `Delete an object: character deletes a card and its file (card layout only); draft_section deletes a whole ${draftUnitLabel(input)} with both body and State files. Keep at least one ${draftUnitLabel(input)}. To clear overview or plot text use edit with content="". Plot structure cannot be deleted here. Accept or reject a pending creation before deleting it.`
        : `删除一个已有对象，只支持两类：kind=character 删除指定人物条目及其文件（仅人物条目样式）；kind=draft_section 删除整个${draftUnitLabel(input)}，正文与状态两个文件会一并删除，不能只删其中一份；正文至少保留一个${draftUnitLabel(input)}。清空人物总稿或剧情阶段的内容不是删除，请用 edit 传 content=""；剧情结构本身不能删除。本轮待创建对象必须先完成或撤销创建提案。`,
    parameters: Type.Object(
      {
        kind: literalUnion(["character", "draft_section"] as const),
        id: stableWritingIdParameter,
        summary: Type.Optional(writingSummaryParameter)
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params) => {
      assertWritingDocumentAvailable(input, state, "");
      const callInput = { ...input, mutationToolCallId: toolCallId };
      const requestedKind: string = params.kind;
      if (
        requestedKind === "character_overview" ||
        requestedKind === "plot_stage"
      ) {
        return textResult(
          input.promptLocale === "en-US"
            ? `Not changed: delete only removes character cards and ${draftUnitLabel(callInput)}s. To clear text, first read the full target, then edit with content="" and allow_overwrite_existing=true.`
            : `未修改：delete 只删除人物条目和${draftUnitLabel(callInput)}。清空${requestedKind === "plot_stage" ? "剧情阶段" : "人物总稿"}的内容请用 edit：先 read 完整读取，再传 content="" 和 allow_overwrite_existing=true。`
        );
      }
      const target = resolveShortUnifiedTarget(callInput, state, {
        kind: params.kind,
        id: String(params.id)
      });
      assertWritingDocumentAvailable(input, state, target.documentId);
      if (
        target.kind === "character" &&
        state.characterItems.get(target.itemId!)?.provisional
      ) {
        throw new Error(
          input.promptLocale === "en-US"
            ? "This character has not been saved. Accept or reject its creation proposal first."
            : "待创建人物条目尚未落盘，请先完成或撤销创建提案。"
        );
      }
      if (
        target.kind === "draft_section" &&
        isProvisionalExpertDraftSectionId(target.sectionId!)
      ) {
        throw new Error(
          input.promptLocale === "en-US"
            ? `This ${draftUnitLabel(callInput)} has not been saved. Accept or reject its creation proposal first.`
            : `待创建${draftUnitLabel(callInput)}尚未落盘，请先完成或撤销创建提案。`
        );
      }
      if (
        target.kind === "draft_section" &&
        state.expertSectionOrder.length <= 1
      ) {
        return textResult(
          input.promptLocale === "en-US"
            ? `Not changed: the manuscript must keep at least one ${draftUnitLabel(callInput)}.`
            : `未修改：正文至少需要保留一个${draftUnitLabel(callInput)}。`
        );
      }

      const rawSummary =
        String(params.summary ?? "").trim() ||
        defaultDeleteSummary(callInput, state, target);
      if (target.kind === "character") {
        return deleteCharacterItemProposal(
          callInput,
          state,
          target,
          rawSummary
        );
      }
      return deleteDraftSectionProposal(callInput, state, target, rawSummary);
    }
  });
}
