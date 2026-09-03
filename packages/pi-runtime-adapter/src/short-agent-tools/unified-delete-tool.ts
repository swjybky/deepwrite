import type { AgentTool } from "@earendil-works/pi-agent-core";
import { isProvisionalExpertDraftSectionId } from "@deepwrite/contracts";
import { Type } from "typebox";
import { defineTool } from "./schema";
import {
  draftUnitLabel,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  stableWritingIdParameter,
  writingKindParameter,
  writingSummaryParameter
} from "./tool-parameters";
import {
  formShortContentProposal,
  shortProposalSummary
} from "./unified-proposal";
import type { ShortUnifiedReadState } from "./unified-read-tool";
import {
  resolveShortUnifiedTarget,
  type ShortUnifiedTarget
} from "./unified-target";
import {
  confirmCrossStageMutation,
  crossStageMutationCancelled,
  crossStageMutationPolicyText
} from "./user-input";

function defaultDeleteSummary(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget
): string {
  if (target.kind === "character_overview") {
    return "清空人物总稿内容，保留人物文本结构";
  }
  if (target.kind === "character") {
    return `删除人物条目《${target.title}》及其文件`;
  }
  if (target.kind === "plot_stage") {
    return `清空剧情阶段《${target.title}》的内容，保留剧情结构`;
  }
  const section = state.expertSections.get(target.sectionId!);
  return `删除${draftUnitLabel(input)}《${section?.title ?? target.title}》及其正文与人物状态文件`;
}

function clearContentProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState,
  target: ShortUnifiedTarget,
  rawSummary: string
) {
  if (target.content.length === 0) {
    return textResult(`无需删除：《${target.title}》的内容已经为空。`);
  }
  return formShortContentProposal(
    input,
    state,
    readState,
    target,
    "",
    rawSummary
  );
}

function deleteCharacterItemProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  rawSummary: string
) {
  const item = state.characterItems.get(target.itemId!);
  if (!item) throw new Error(`不存在人物条目 ${target.id}。`);
  if (item.provisional) {
    throw new Error("待创建人物条目尚未落盘，请先完成或撤销创建提案。");
  }
  state.characterItems.delete(item.id);
  state.characterItemOrder = state.characterItemOrder.filter(
    (itemId) => itemId !== item.id
  );
  const summary = shortProposalSummary(input, rawSummary);
  return textResult(summary, {
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
}

function deleteDraftSectionProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  rawSummary: string
) {
  const sectionId = target.sectionId!;
  const section = state.expertSections.get(sectionId);
  if (!section) {
    throw new Error(`不存在${draftUnitLabel(input)} ${sectionId}。`);
  }
  if (isProvisionalExpertDraftSectionId(section.id)) {
    throw new Error(
      `待创建${draftUnitLabel(input)}尚未落盘，请先完成或撤销创建提案。`
    );
  }
  if (state.expertSectionOrder.length <= 1) {
    return textResult(`未删除：正文至少需要保留一个${draftUnitLabel(input)}。`);
  }
  state.expertSections.delete(section.id);
  state.expertSectionOrder = state.expertSectionOrder.filter(
    (candidate) => candidate !== section.id
  );
  const summary = shortProposalSummary(input, rawSummary);
  return textResult(summary, {
    kind: "workspace-expert-draft-section-deletion",
    workspaceId: input.workspace.id,
    stageId: "draft",
    sectionId: section.id,
    title: section.title,
    baseRevision: state.expertDraftDirectoryBaseRevision,
    summary
  });
}

export function buildShortUnifiedDeleteTool(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState
): AgentTool {
  return defineTool({
    name: "delete",
    label: `删除${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description: `删除一个已有对象。人物文本样式只能用 kind=character_overview 清空总稿，不删除人物结构；人物条目样式只能用 kind=character 删除指定人物条目及其文件。kind=plot_stage 只清空该阶段正文，绝不删除或修改剧情结构。kind=draft_section 删除整个${draftUnitLabel(input)}，正文与人物状态两个文件会一并删除，不能只删其中一份；正文至少保留一个${draftUnitLabel(input)}。本轮待创建对象必须先完成或撤销创建提案。${crossStageMutationPolicyText(input)}`,
    parameters: Type.Object(
      {
        kind: writingKindParameter,
        id: stableWritingIdParameter,
        summary: Type.Optional(writingSummaryParameter)
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const target = resolveShortUnifiedTarget(input, state, {
        kind: params.kind,
        id: String(params.id)
      });
      const characterFormat =
        input.workspace.characterStructure?.format ?? "text";
      if (target.kind === "character_overview" && characterFormat !== "text") {
        throw new Error(
          "当前人物为条目样式，请用 kind=character 和人物条目 id 删除具体人物。"
        );
      }
      if (target.kind === "character" && characterFormat !== "list") {
        throw new Error(
          "当前人物为文本样式，请用 kind=character_overview、id=character_design 清空人物总稿。"
        );
      }
      if (
        target.kind === "character" &&
        state.characterItems.get(target.itemId!)?.provisional
      ) {
        throw new Error("待创建人物条目尚未落盘，请先完成或撤销创建提案。");
      }
      if (
        target.kind === "plot_stage" &&
        state.plotStages.get(target.stageId)?.provisional
      ) {
        throw new Error("待创建剧情阶段尚未落盘，请先完成或撤销创建提案。");
      }
      if (
        target.kind === "draft_section" &&
        isProvisionalExpertDraftSectionId(target.sectionId!)
      ) {
        throw new Error(
          `待创建${draftUnitLabel(input)}尚未落盘，请先完成或撤销创建提案。`
        );
      }
      if (
        (target.kind === "character_overview" ||
          target.kind === "plot_stage") &&
        target.content.length === 0
      ) {
        return textResult(`无需删除：《${target.title}》的内容已经为空。`);
      }
      if (
        target.kind === "draft_section" &&
        state.expertSectionOrder.length <= 1
      ) {
        return textResult(
          `未删除：正文至少需要保留一个${draftUnitLabel(input)}。`
        );
      }

      const rawSummary =
        String(params.summary ?? "").trim() ||
        defaultDeleteSummary(input, state, target);
      const decision = await confirmCrossStageMutation(input, {
        toolCallId,
        targetStageId: target.stageId,
        targetTitle:
          target.kind === "draft_section"
            ? (state.expertSections.get(target.sectionId!)?.title ??
              target.title)
            : target.title,
        operationLabel: "删除",
        ...(signal ? { signal } : {})
      });
      if (decision === "cancel") {
        return crossStageMutationCancelled(input, target.stageId);
      }

      if (
        target.kind === "character_overview" ||
        target.kind === "plot_stage"
      ) {
        return clearContentProposal(
          input,
          state,
          readState,
          target,
          rawSummary
        );
      }
      if (target.kind === "character") {
        return deleteCharacterItemProposal(input, state, target, rawSummary);
      }
      return deleteDraftSectionProposal(input, state, target, rawSummary);
    }
  });
}
