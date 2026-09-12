import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  type ExpertDraftSectionSnapshot,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";
import { Type } from "typebox";
import {
  appendWritingContentCounts,
  WRITING_CONTENT_COUNT_DESCRIPTION
} from "../writing-content-counts";
import { defineTool } from "./schema";
import {
  draftUnitLabel,
  scriptBodyToolConstraint,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  writingContentParameter,
  writingCreateKindParameter,
  writingCreateMetaParameter,
  writingSummaryParameter
} from "./tool-parameters";
import { shortProposalSummary } from "./unified-proposal";
import {
  confirmCrossStageMutation,
  crossStageMutationCancelled
} from "./user-input";

type CreateMeta = {
  title: string;
  description?: string;
  word_count_requirement?: string;
  after_id?: string;
};

function requireTitle(meta: CreateMeta): string {
  const title = meta.title?.trim() ?? "";
  if (!title) throw new Error("meta.title 不能为空。");
  return title;
}

function rejectFields(meta: CreateMeta, fields: Array<keyof CreateMeta>): void {
  const unexpected = fields.filter((field) => meta[field] !== undefined);
  if (unexpected.length) {
    throw new Error(`当前 kind 不接受 meta.${unexpected.join("、meta.")}。`);
  }
}

function characterCreation(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  title: string,
  content: string,
  rawSummary: string
) {
  if ((input.workspace.characterStructure?.format ?? "text") !== "list") {
    throw new Error(
      "当前人物为文本样式，不能创建独立人物条目。请把所有人物写进同一份总稿：用 edit 修改 kind=character_overview、id=character_design。"
    );
  }
  if (
    [...state.characterItems.values()].some(
      (item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    throw new Error("已存在同名人物条目。");
  }
  state.pendingCharacterSeq += 1;
  const itemId = `character_${Date.now().toString(36)}_${state.pendingCharacterSeq}`;
  state.characterItems.set(itemId, {
    id: itemId,
    title,
    order: state.characterItemOrder.length + 1,
    content,
    revision: createShortWorkspaceContentRevision(content),
    provisional: true
  });
  state.characterItemOrder.push(itemId);
  const summary = shortProposalSummary(input, rawSummary);
  const message = appendWritingContentCounts(`${summary}\nitem_id=${itemId}`, [
    { title, id: itemId, content }
  ]);
  return textResult(message, {
    kind: "workspace-character-structure-mutation",
    workspaceId: input.workspace.id,
    stageId: "character_design",
    mutation: { type: "createItem", title, provisionalItemId: itemId },
    baseRevision: state.stageRevisions.get("character_design")!,
    summary,
    ...(content ? { initialContent: content } : {})
  });
}

function plotStructureRevision(state: ShortWorkspaceToolSharedState): string {
  return createShortWorkspaceContentRevision(
    state.plotStageOrder
      .map((id) => {
        const stage = state.plotStages.get(id)!;
        return `${stage.id}\u0000${stage.title}\u0000${stage.description}`;
      })
      .join("\u0001")
  );
}

function plotStageCreation(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  title: string,
  description: string,
  content: string,
  rawSummary: string
) {
  if (state.plotStageOrder.length >= 32) {
    throw new Error("剧情结构最多支持 32 项。");
  }
  if (
    [...state.plotStages.values()].some(
      (stage) => stage.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    throw new Error("已存在同名剧情结构。");
  }
  const baseRevision = plotStructureRevision(state);
  state.pendingPlotStageSeq += 1;
  const stageId =
    `pending:plot-stage:${state.pendingPlotStageSeq}` as ShortWorkspaceStageId;
  state.plotStages.set(stageId, {
    id: stageId,
    title,
    description,
    provisional: true
  });
  state.plotStageOrder.push(stageId);
  state.stageBodies.set(stageId, content);
  state.stageRevisions.set(
    stageId,
    createShortWorkspaceContentRevision(content)
  );
  const summary = shortProposalSummary(input, rawSummary);
  const message = appendWritingContentCounts(
    `${summary}\nstage_id=${stageId}`,
    [{ title, id: stageId, content }]
  );
  return textResult(message, {
    kind: "workspace-plot-structure-mutation",
    workspaceId: input.workspace.id,
    stageId,
    mutation: {
      type: "create",
      title,
      description,
      provisionalStageId: stageId,
      content
    },
    baseRevision,
    summary
  });
}

function draftSectionSnapshot(
  sectionId: string,
  title: string,
  wordCountRequirement: string,
  bodyContent: string,
  characterStateContent: string
): ExpertDraftSectionSnapshot {
  return {
    id: sectionId,
    title,
    wordCountRequirement,
    body: {
      documentId: catalogDraftBodyDocumentId(sectionId),
      title,
      content: bodyContent,
      revision: createShortWorkspaceContentRevision(bodyContent)
    },
    characterState: {
      documentId: catalogDraftCharacterStateDocumentId(sectionId),
      title: `${title} · 人物状态`,
      content: characterStateContent,
      revision: createShortWorkspaceContentRevision(characterStateContent)
    }
  };
}

function draftSectionCreation(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  title: string,
  wordCountRequirement: string,
  afterId: string,
  bodyContent: string,
  characterStateContent: string,
  rawSummary: string
) {
  if (state.expertSectionOrder.length >= 100) {
    throw new Error(`正文最多支持 100 个${draftUnitLabel(input)}。`);
  }
  if (
    [...state.expertSections.values()].some(
      (section) =>
        section.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    ) ||
    [...state.pendingExpertSectionTitles].some(
      (pending) => pending.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    throw new Error(`正文目录已存在同名${draftUnitLabel(input)}。`);
  }
  let insertAt = state.expertSectionOrder.length;
  if (afterId) {
    const index = state.expertSectionOrder.indexOf(afterId);
    if (index < 0) {
      throw new Error(`找不到插入位置${draftUnitLabel(input)} ${afterId}。`);
    }
    insertAt = index + 1;
  }
  state.pendingSectionSeq += 1;
  const sectionId = `${PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX}${state.pendingSectionSeq}`;
  state.expertSections.set(
    sectionId,
    draftSectionSnapshot(
      sectionId,
      title,
      wordCountRequirement,
      bodyContent,
      characterStateContent
    )
  );
  state.expertSectionOrder.splice(insertAt, 0, sectionId);
  state.pendingExpertSectionTitles.add(title);
  const summary = shortProposalSummary(input, rawSummary);
  const message = appendWritingContentCounts(
    `${summary}\nsection_id=${sectionId}`,
    [
      {
        title: `${title} · 正文`,
        id: catalogDraftBodyDocumentId(sectionId),
        content: bodyContent
      },
      {
        title: `${title} · 人物状态`,
        id: catalogDraftCharacterStateDocumentId(sectionId),
        content: characterStateContent
      }
    ]
  );
  return textResult(message, {
    kind: "workspace-expert-draft-section-creation",
    workspaceId: input.workspace.id,
    stageId: "draft",
    sections: [
      {
        title,
        wordCountRequirement,
        provisionalSectionId: sectionId,
        ...(bodyContent ? { bodyContent } : {}),
        ...(characterStateContent ? { characterStateContent } : {})
      }
    ],
    ...(afterId ? { afterSectionId: afterId } : {}),
    baseRevision: state.expertDraftDirectoryBaseRevision,
    summary
  });
}

function characterCreateRule(input: BuildWritingWorkspaceToolsInput): string {
  return (input.workspace.characterStructure?.format ?? "text") === "list"
    ? "当前人物为条目样式：kind=character 为单个人物创建独立条目，并可同时写入该人物卡正文；概览只做索引，不要把多人设定写进概览。"
    : "当前人物为文本样式：不要用 kind=character 创建独立条目。创建人物就是把所有人设写入同一份 character_overview（id=character_design），使用 edit。";
}

export function buildShortUnifiedCreateTool(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState
): AgentTool {
  return defineTool({
    name: "create",
    label: `创建${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description:
      `一次新建一个对象。${characterCreateRule(input)} kind=plot_stage 创建一项全局剧情结构，并同时携带该结构在当前作品中的正文；kind=draft_section 创建${draftUnitLabel(input)}，可同时写入 body 与 character_state。meta 只放该 kind 需要的结构字段，id 与排序由系统生成。` +
      scriptBodyToolConstraint(input) +
      WRITING_CONTENT_COUNT_DESCRIPTION,
    parameters: Type.Object(
      {
        kind: writingCreateKindParameter,
        meta: writingCreateMetaParameter,
        content: Type.Optional(writingContentParameter),
        character_state: Type.Optional(writingContentParameter),
        summary: Type.Optional(writingSummaryParameter)
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const meta = params.meta as CreateMeta;
      const title = requireTitle(meta);
      const content = String(params.content ?? "");
      const summary =
        String(params.summary ?? "").trim() ||
        `新建${params.kind === "character" ? "人物" : params.kind === "plot_stage" ? "剧情结构" : draftUnitLabel(input)}《${title}》`;
      const targetStageId: ShortWorkspaceStageId =
        params.kind === "character"
          ? "character_design"
          : params.kind === "draft_section"
            ? "draft"
            : (state.plotStageOrder[0] ??
              ("pending:plot-stage:create" as ShortWorkspaceStageId));
      const decision = await confirmCrossStageMutation(input, {
        toolCallId,
        targetStageId,
        targetTitle: title,
        operationLabel: "新建",
        ...(signal ? { signal } : {})
      });
      if (decision === "cancel") {
        return crossStageMutationCancelled(input, targetStageId);
      }

      if (params.kind === "character") {
        rejectFields(meta, [
          "description",
          "word_count_requirement",
          "after_id"
        ]);
        if (params.character_state !== undefined) {
          throw new Error("character 不接受 character_state。");
        }
        return characterCreation(input, state, title, content, summary);
      }
      if (params.kind === "plot_stage") {
        rejectFields(meta, ["word_count_requirement", "after_id"]);
        if (params.character_state !== undefined) {
          throw new Error("plot_stage 不接受 character_state。");
        }
        const description = meta.description?.trim() ?? "";
        if (!description) {
          throw new Error("plot_stage 必须提供 meta.description。");
        }
        return plotStageCreation(
          input,
          state,
          title,
          description,
          content,
          summary
        );
      }
      rejectFields(meta, ["description"]);
      return draftSectionCreation(
        input,
        state,
        title,
        meta.word_count_requirement?.trim() ?? "",
        meta.after_id?.trim() ?? "",
        content,
        String(params.character_state ?? ""),
        summary
      );
    }
  });
}
