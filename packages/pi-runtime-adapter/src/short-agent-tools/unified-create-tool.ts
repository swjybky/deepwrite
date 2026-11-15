import { draftSectionCreation } from "./draft-section-creation";
import { assertWritingDocumentAvailable } from "./settlement";
import { trackWritingMutation } from "./settlement";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createShortWorkspaceContentRevision,
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
  provisionalIdHint,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import { writingParameters } from "./tool-parameters";
import { shortProposalSummary } from "./unified-proposal";
import {
  confirmPlotStructureChange,
  plotStructureChangeDeclined
} from "./plot-structure-confirmation";

type CreateMeta = {
  title: string;
  description?: string;
  word_count_requirement?: string;
  after_id?: string;
};

function requireTitle(
  input: BuildWritingWorkspaceToolsInput,
  meta: CreateMeta
): string {
  const title = meta.title?.trim() ?? "";
  if (!title)
    throw new Error(
      input.promptLocale === "en-US"
        ? "meta.title cannot be empty."
        : "meta.title 不能为空。"
    );
  return title;
}

function rejectFields(
  input: BuildWritingWorkspaceToolsInput,
  meta: CreateMeta,
  fields: Array<keyof CreateMeta>
): void {
  const unexpected = fields.filter((field) => meta[field] !== undefined);
  if (unexpected.length) {
    throw new Error(
      input.promptLocale === "en-US"
        ? `This kind does not accept meta.${unexpected.join(", meta.")}.`
        : `当前 kind 不接受 meta.${unexpected.join("、meta.")}。`
    );
  }
}

function characterCreation(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  title: string,
  content: string,
  rawSummary: string
) {
  return trackWritingMutation(input, state, () => {
    if ((input.workspace.characterStructure?.format ?? "text") !== "list") {
      throw new Error(
        input.promptLocale === "en-US"
          ? "Characters use text layout. Do not create separate cards; edit kind=character_overview, id=character_design for all profiles."
          : "当前人物为文本样式，不能创建独立人物条目。请把所有人物写进同一份总稿：用 edit 修改 kind=character_overview、id=character_design。"
      );
    }
    if (
      [...state.characterItems.values()].some(
        (item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase()
      )
    ) {
      throw new Error(
        input.promptLocale === "en-US"
          ? "A character with that title already exists."
          : "已存在同名人物条目。"
      );
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
    const summary = rawSummary.trim();
    const message = appendWritingContentCounts(
      `${shortProposalSummary(input, summary)}\nitem_id=${itemId}\n${provisionalIdHint(input)}`,
      [{ title, id: itemId, content }],
      input.promptLocale
    );
    return textResult(message, {
      kind: "workspace-character-structure-mutation",
      workspaceId: input.workspace.id,
      stageId: "character_design",
      mutation: { type: "createItem", title, provisionalItemId: itemId },
      baseRevision: state.stageRevisions.get("character_design")!,
      summary,
      ...(content ? { initialContent: content } : {})
    });
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

async function plotStageCreation(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  title: string,
  description: string,
  content: string,
  rawSummary: string,
  request: { toolCallId: string; signal?: AbortSignal }
) {
  if (state.plotStageOrder.length >= 32) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "At most 32 plot stages are supported."
        : "剧情结构最多支持 32 项。"
    );
  }
  if (
    [...state.plotStages.values()].some(
      (stage) => stage.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "A plot stage with that title already exists."
        : "已存在同名剧情结构。"
    );
  }
  const allowed = await confirmPlotStructureChange(input, state, {
    ...request,
    change:
      input.promptLocale === "en-US"
        ? `add plot stage “${title}”`
        : `新增剧情结构《${title}》`
  });
  if (!allowed) return plotStructureChangeDeclined(input);
  return trackWritingMutation(input, state, () => {
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
    const summary = rawSummary.trim();
    const message = appendWritingContentCounts(
      `${shortProposalSummary(input, summary)}\nstage_id=${stageId}\n${provisionalIdHint(input)}`,
      [{ title, id: stageId, content }],
      input.promptLocale
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
  });
}

function characterCreateRule(input: BuildWritingWorkspaceToolsInput): string {
  return (input.workspace.characterStructure?.format ?? "text") === "list"
    ? input.promptLocale === "en-US"
      ? "Card layout: kind=character creates one card and may include its text. The overview is an index, not a combined profile document."
      : "当前人物为条目样式：kind=character 为单个人物创建独立条目，并可同时写入该人物卡正文；概览只做索引，不要把多人设定写进概览。"
    : input.promptLocale === "en-US"
      ? "Text layout: do not create character cards. Edit character_overview, id=character_design for all profiles."
      : "当前人物为文本样式：不要用 kind=character 创建独立条目。创建人物就是把所有人设写入同一份 character_overview（id=character_design），使用 edit。";
}

export function buildShortUnifiedCreateTool(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState
): AgentTool {
  const {
    writingContentParameter,
    writingCreateKindParameter,
    writingCreateMetaParameter,
    writingSummaryParameter
  } = writingParameters(input);
  return defineTool({
    name: "create",
    label:
      input.promptLocale === "en-US"
        ? `Create ${input.workspaceType === "script" ? "screenplay" : "short-fiction"} object`
        : `创建${input.workspaceType === "script" ? "剧本" : "短篇"}对象`,
    description:
      (input.promptLocale === "en-US"
        ? `Create one object, or use items to create an ordered batch of sections/episodes in one proposal. ${characterCreateRule(input)} plot_stage creates shared global structure and its text in this work; draft_section creates a ${draftUnitLabel(input)} with optional content (body) and state. meta contains only supported structural fields. The system assigns ids; after_id optionally sets insertion position.`
        : `创建单个对象，或用 items 按顺序批量创建小节或剧集，整组生成一张提案。${characterCreateRule(input)} kind=plot_stage 创建一项全局剧情结构，并同时携带该结构在当前作品中的正文；kind=draft_section 创建${draftUnitLabel(input)}，可用 content 写正文，用 state 写状态。meta 只放该 kind 需要的结构字段，id 与排序由系统生成。`) +
      (input.promptLocale === "en-US"
        ? " Proposal counts exclude whitespace and do not confirm a save."
        : WRITING_CONTENT_COUNT_DESCRIPTION),
    parameters: Type.Object(
      {
        kind: writingCreateKindParameter,
        meta: Type.Optional(writingCreateMetaParameter),
        items: Type.Optional(
          Type.Array(
            Type.Object(
              {
                title: writingCreateMetaParameter.properties.title,
                word_count_requirement:
                  writingCreateMetaParameter.properties.word_count_requirement,
                content: Type.Optional(writingContentParameter),
                state: Type.Optional(writingContentParameter)
              },
              { additionalProperties: false }
            ),
            {
              minItems: 1,
              maxItems: 100,
              description:
                input.promptLocale === "en-US"
                  ? "draft_section only. Supply ordered items instead of top-level meta/content/state."
                  : "仅 draft_section，按目录顺序提供条目，不能与顶层 meta、content、state 混用。"
            }
          )
        ),
        after_id: writingCreateMetaParameter.properties.after_id,
        content: Type.Optional(writingContentParameter),
        state: Type.Optional(
          Type.Unsafe<string>({
            ...writingContentParameter,
            description:
              input.promptLocale === "en-US"
                ? "draft_section only: State notes for character, plot, emotional or any other continuity information."
                : "仅 draft_section：状态可记录人物、剧情、情感等任何需要延续的信息。"
          })
        ),
        character_state: Type.Optional(
          Type.Unsafe<string>({
            ...writingContentParameter,
            description:
              input.promptLocale === "en-US"
                ? "Legacy alias for state. Supply only one."
                : "state 的兼容别名，二者只传一个。"
          })
        ),
        summary: Type.Optional(writingSummaryParameter)
      },
      { additionalProperties: false }
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      assertWritingDocumentAvailable(input, state, "");
      const callInput = { ...input, mutationToolCallId: toolCallId };
      if (params.items !== undefined) {
        if (
          params.kind !== "draft_section" ||
          params.meta ||
          params.content !== undefined ||
          params.state !== undefined ||
          params.character_state !== undefined
        )
          throw new Error(
            input.promptLocale === "en-US"
              ? "items requires draft_section and excludes top-level meta, content and state."
              : "items 仅用于 draft_section，不能与顶层 meta、content、state 混用。"
          );
        const summary =
          params.summary?.trim() ||
          (input.promptLocale === "en-US"
            ? `Create ${params.items.length} ${draftUnitLabel(input)}s`
            : `创建 ${params.items.length} 个${draftUnitLabel(input)}`);
        return draftSectionCreation(
          callInput,
          state,
          params.items,
          params.after_id,
          summary
        );
      }
      if (!params.meta || params.after_id !== undefined)
        throw new Error(
          input.promptLocale === "en-US"
            ? "Single creation requires meta; put the insertion id in meta.after_id."
            : "单项创建必须提供 meta，插入位置使用 meta.after_id。"
        );
      const meta = params.meta;
      const title = requireTitle(input, meta);
      if (params.state !== undefined && params.character_state !== undefined)
        throw new Error(
          input.promptLocale === "en-US"
            ? "Supply only one of state and character_state."
            : "state 和 character_state 只能传一个。"
        );
      const stateContent = params.state ?? params.character_state;
      const content = String(params.content ?? "");
      const summary =
        String(params.summary ?? "").trim() ||
        (input.promptLocale === "en-US"
          ? `Create ${params.kind === "character" ? "character" : params.kind === "plot_stage" ? "plot stage" : draftUnitLabel(callInput)} “${title}”`
          : `新建${params.kind === "character" ? "人物" : params.kind === "plot_stage" ? "剧情结构" : draftUnitLabel(callInput)}《${title}》`);

      if (params.kind === "character") {
        rejectFields(input, meta, [
          "description",
          "word_count_requirement",
          "after_id"
        ]);
        if (stateContent !== undefined) {
          throw new Error(
            input.promptLocale === "en-US"
              ? "character does not accept state."
              : "character 不接受 state。"
          );
        }
        return characterCreation(callInput, state, title, content, summary);
      }
      if (params.kind === "plot_stage") {
        rejectFields(input, meta, ["word_count_requirement", "after_id"]);
        if (stateContent !== undefined) {
          throw new Error(
            input.promptLocale === "en-US"
              ? "plot_stage does not accept state."
              : "plot_stage 不接受 state。"
          );
        }
        const description = meta.description?.trim() ?? "";
        if (!description) {
          throw new Error(
            input.promptLocale === "en-US"
              ? "plot_stage requires meta.description."
              : "plot_stage 必须提供 meta.description。"
          );
        }
        return plotStageCreation(
          callInput,
          state,
          title,
          description,
          content,
          summary,
          { toolCallId, ...(signal ? { signal } : {}) }
        );
      }
      rejectFields(input, meta, ["description"]);
      return draftSectionCreation(
        callInput,
        state,
        [
          {
            title,
            word_count_requirement: meta.word_count_requirement ?? "",
            content,
            state: stateContent ?? ""
          }
        ],
        meta.after_id?.trim(),
        summary
      );
    }
  });
}
