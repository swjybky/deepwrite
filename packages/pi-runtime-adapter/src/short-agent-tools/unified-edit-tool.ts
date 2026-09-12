import type { AgentTool } from "@earendil-works/pi-agent-core";
import { isProvisionalExpertDraftSectionId } from "@deepwrite/contracts";
import { Type } from "typebox";
import {
  WRITING_EDIT_CONTENT_DESCRIPTION,
  WRITING_EDIT_CONTENT_GUIDANCE,
  WRITING_EDIT_OVERWRITE_DESCRIPTION,
  WRITING_EDIT_OVERWRITE_RECOVERY
} from "../writing-edit-guidance";
import { WRITING_CONTENT_COUNT_DESCRIPTION } from "../writing-content-counts";
import { defineTool } from "./schema";
import {
  draftUnitLabel,
  orderedExpertSections,
  replaceText,
  scriptBodyToolConstraint,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  explicitTrueParameter,
  stableWritingIdParameter,
  writingContentParameter,
  writingDocumentParameter,
  writingEditMetaParameter,
  writingKindParameter,
  writingSummaryParameter
} from "./tool-parameters";
import {
  formShortContentProposal,
  shortProposalSummary
} from "./unified-proposal";
import {
  hasCurrentReadEvidence,
  type ShortUnifiedReadState
} from "./unified-read-tool";
import {
  assertWritableTarget,
  resolveShortUnifiedTarget,
  resolveWritingMutationKind,
  type ShortUnifiedTarget
} from "./unified-target";
import {
  confirmCrossStageMutation,
  crossStageMutationPolicyText,
  crossStageMutationCancelled
} from "./user-input";

interface EditMeta {
  title?: string;
  description?: string;
  move?: "up" | "down";
}

function characterMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  if (meta.description !== undefined) {
    throw new Error("character 的 meta 不接受 description。");
  }
  if (
    Number(meta.title !== undefined) + Number(meta.move !== undefined) !==
    1
  ) {
    throw new Error("人物 meta 必须且只能选择 title 或 move。");
  }
  const item = state.characterItems.get(target.itemId!);
  if (!item) throw new Error(`不存在人物条目 ${target.id}。`);
  const summary = shortProposalSummary(input, rawSummary);
  if (meta.title !== undefined) {
    const title = meta.title.trim();
    if (!title) throw new Error("人物标题不能为空。");
    if (
      [...state.characterItems.values()].some(
        (candidate) =>
          candidate.id !== item.id &&
          candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
      )
    ) {
      throw new Error("已存在同名人物条目。");
    }
    const previousTitle = item.title;
    state.characterItems.set(item.id, { ...item, title });
    return textResult(summary, {
      kind: "workspace-character-structure-mutation",
      workspaceId: input.workspace.id,
      stageId: "character_design",
      mutation: { type: "updateItem", itemId: item.id, previousTitle, title },
      baseRevision: state.stageRevisions.get("character_design")!,
      summary
    });
  }
  const direction = meta.move!;
  const index = state.characterItemOrder.indexOf(item.id);
  const destination = direction === "up" ? index - 1 : index + 1;
  if (destination < 0 || destination >= state.characterItemOrder.length) {
    throw new Error("人物条目已经位于列表边界。");
  }
  [state.characterItemOrder[index], state.characterItemOrder[destination]] = [
    state.characterItemOrder[destination]!,
    state.characterItemOrder[index]!
  ];
  return textResult(summary, {
    kind: "workspace-character-structure-mutation",
    workspaceId: input.workspace.id,
    stageId: "character_design",
    mutation: {
      type: "moveItem",
      itemId: item.id,
      direction,
      title: item.title
    },
    baseRevision: state.stageRevisions.get("character_design")!,
    summary
  });
}

function plotStageMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  if (meta.move !== undefined) {
    throw new Error("剧情结构排序由界面管理，plot_stage 的 meta 不接受 move。");
  }
  const stage = state.plotStages.get(target.id);
  if (!stage) throw new Error(`不存在剧情结构 ${target.id}。`);
  if (stage.provisional) {
    throw new Error(
      "待创建剧情结构不能在同一轮改名，请在 create 时直接使用目标信息。"
    );
  }
  const title = meta.title?.trim() ?? stage.title;
  const description = meta.description?.trim() ?? stage.description;
  if (!title) throw new Error("剧情结构标题不能为空。");
  if (!description) throw new Error("剧情结构说明不能为空。");
  if (
    [...state.plotStages.values()].some(
      (candidate) =>
        candidate.id !== stage.id &&
        candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    throw new Error("已存在同名剧情结构。");
  }
  state.plotStages.set(stage.id, { ...stage, title, description });
  const summary = shortProposalSummary(input, rawSummary);
  return textResult(summary, {
    kind: "workspace-plot-structure-mutation",
    workspaceId: input.workspace.id,
    stageId: target.stageId,
    mutation: {
      type: "update",
      stageId: target.stageId,
      previousTitle: stage.title,
      title,
      description
    },
    baseRevision: target.revision,
    summary
  });
}

function draftMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  if (meta.move || meta.description !== undefined) {
    throw new Error(
      `${draftUnitLabel(input)} meta 只支持 title；排序由界面管理。`
    );
  }
  const section = state.expertSections.get(target.sectionId!);
  if (!section) {
    throw new Error(`不存在${draftUnitLabel(input)} ${target.id}。`);
  }
  if (isProvisionalExpertDraftSectionId(section.id)) {
    throw new Error(
      `待创建${draftUnitLabel(input)}不能在同一轮改名，请创建时直接使用目标标题。`
    );
  }
  const title = meta.title?.trim() ?? "";
  if (!title) throw new Error(`${draftUnitLabel(input)}标题不能为空。`);
  if (
    orderedExpertSections(input, state.expertSections).some(
      (candidate) => candidate.id !== section.id && candidate.title === title
    )
  ) {
    throw new Error(`正文目录已存在同名${draftUnitLabel(input)}。`);
  }
  const previousTitle = section.title;
  state.expertSections.set(section.id, {
    ...section,
    title,
    body: { ...section.body, title },
    characterState: { ...section.characterState, title: `${title} · 人物状态` }
  });
  const summary = shortProposalSummary(input, rawSummary);
  return textResult(summary, {
    kind: "workspace-expert-draft-section-rename",
    workspaceId: input.workspace.id,
    stageId: "draft",
    sectionId: section.id,
    previousTitle,
    title,
    baseRevision: state.expertDraftDirectoryBaseRevision,
    summary
  });
}

export function buildShortUnifiedEditTool(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState
): AgentTool {
  return defineTool({
    name: "edit",
    label: `修改${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description:
      `修改一个已有对象。提供稳定小节 id 和 document 时可省略 kind，按 draft_section 定位。${WRITING_EDIT_CONTENT_GUIDANCE}kind=draft_section 修改正文或人物状态时必须同时给出 document=body 或 character_state；只改小节标题的 meta 可不传 document。meta 用于人物改名/移动、剧情结构标题与说明修改、正文小节改名。content、replacements、meta 只能选择一种。${crossStageMutationPolicyText(input)}` +
      scriptBodyToolConstraint(input) +
      WRITING_CONTENT_COUNT_DESCRIPTION,
    parameters: Type.Object(
      {
        kind: Type.Optional(writingKindParameter),
        id: stableWritingIdParameter,
        document: Type.Optional(writingDocumentParameter),
        content: Type.Optional(
          Type.Unsafe<string>({
            ...writingContentParameter,
            description: WRITING_EDIT_CONTENT_DESCRIPTION
          })
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
        allow_overwrite_existing: Type.Optional(
          Type.Unsafe<true>({
            ...explicitTrueParameter,
            description: WRITING_EDIT_OVERWRITE_DESCRIPTION
          })
        ),
        summary: writingSummaryParameter
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const kind = resolveWritingMutationKind(params.kind, params.document);
      if (kind === "draft_section" && !params.document && !params.meta) {
        throw new Error(
          "修改 draft_section 正文时必须指定 document=body 或 character_state。"
        );
      }
      const target = resolveShortUnifiedTarget(input, state, {
        kind,
        id: String(params.id),
        ...(params.document ? { document: params.document } : {})
      });
      assertWritableTarget(input, target);
      const decision = await confirmCrossStageMutation(input, {
        toolCallId,
        targetStageId: target.stageId,
        targetTitle: target.title,
        operationLabel: "修改",
        ...(signal ? { signal } : {})
      });
      if (decision === "cancel") {
        return crossStageMutationCancelled(input, target.stageId);
      }

      const intentCount =
        Number(params.content !== undefined) +
        Number(Boolean(params.replacements?.length)) +
        Number(params.meta !== undefined);
      if (intentCount !== 1) {
        throw new Error("edit 必须且只能选择 content、replacements 或 meta。");
      }
      if (params.meta) {
        if (target.kind === "character_overview") {
          throw new Error("人物概览不支持 meta 修改。");
        }
        if (target.kind === "character") {
          return characterMetaProposal(
            input,
            state,
            target,
            params.meta as EditMeta,
            String(params.summary)
          );
        }
        if (target.kind === "plot_stage") {
          return plotStageMetaProposal(
            input,
            state,
            target,
            params.meta as EditMeta,
            String(params.summary)
          );
        }
        return draftMetaProposal(
          input,
          state,
          target,
          params.meta as EditMeta,
          String(params.summary)
        );
      }

      if (target.content.trim() && !hasCurrentReadEvidence(readState, target)) {
        return textResult(`未修改：请先用 read 完整读取「${target.title}」。`);
      }
      if (params.content !== undefined) {
        if (target.content.trim() && params.allow_overwrite_existing !== true) {
          return textResult(WRITING_EDIT_OVERWRITE_RECOVERY);
        }
        return formShortContentProposal(
          input,
          state,
          readState,
          target,
          String(params.content),
          String(params.summary)
        );
      }

      const replaced = replaceText(target.content, params.replacements!);
      if (replaced.error || replaced.next === undefined) {
        return textResult(`未修改：${replaced.error ?? "未知错误"}`);
      }
      return formShortContentProposal(
        input,
        state,
        readState,
        target,
        replaced.next,
        String(params.summary)
      );
    }
  });
}
