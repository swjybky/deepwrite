import { trackWritingMutation } from "./settlement";
import { draftMetaProposal } from "./draft-section-meta";
import {
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  confirmPlotStructureChange,
  plotStructureChangeDeclined
} from "./plot-structure-confirmation";
import { shortProposalSummary, unchanged } from "./unified-proposal";
import type { ShortUnifiedTarget } from "./unified-target";

export interface EditMeta {
  title?: string;
  description?: string;
  move?: "up" | "down";
  word_count_requirement?: string;
  after_id?: string;
}

function characterMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  return trackWritingMutation(input, state, () => {
    if (meta.description !== undefined) {
      throw new Error(
        input.promptLocale === "en-US"
          ? "Character meta does not accept description."
          : "character 的 meta 不接受 description。"
      );
    }
    if (
      Number(meta.title !== undefined) + Number(meta.move !== undefined) !==
      1
    ) {
      throw new Error(
        input.promptLocale === "en-US"
          ? "Character meta requires exactly one of title or move."
          : "人物 meta 必须且只能选择 title 或 move。"
      );
    }
    const item = state.characterItems.get(target.itemId!);
    if (!item)
      throw new Error(
        input.promptLocale === "en-US"
          ? `Character ${target.id} was not found. Read kind=workspace, id=workspace for current ids.`
          : `不存在人物条目 ${target.id}。请用 read（kind=workspace，id=workspace）查询最新 id。`
      );
    const summary = rawSummary.trim();
    if (meta.title !== undefined) {
      const title = meta.title.trim();
      if (!title)
        throw new Error(
          input.promptLocale === "en-US"
            ? "Character title cannot be empty."
            : "人物标题不能为空。"
        );
      if (
        [...state.characterItems.values()].some(
          (candidate) =>
            candidate.id !== item.id &&
            candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
        )
      ) {
        throw new Error(
          input.promptLocale === "en-US"
            ? "A character with that title already exists."
            : "已存在同名人物条目。"
        );
      }
      if (item.title === title) return unchanged(input);
      const previousTitle = item.title;
      state.characterItems.set(item.id, { ...item, title });
      return textResult(shortProposalSummary(input, summary), {
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
      throw new Error(
        input.promptLocale === "en-US"
          ? "The character is already at the edge of the list."
          : "人物条目已经位于列表边界。"
      );
    }
    [state.characterItemOrder[index], state.characterItemOrder[destination]] = [
      state.characterItemOrder[destination]!,
      state.characterItemOrder[index]!
    ];
    return textResult(shortProposalSummary(input, summary), {
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
  });
}

async function plotStageMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string,
  request: { toolCallId: string; signal?: AbortSignal }
) {
  if (meta.move !== undefined) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "Reorder plot stages in the interface; plot_stage meta does not accept move."
        : "剧情结构排序由界面管理，plot_stage 的 meta 不接受 move。"
    );
  }
  const stage = state.plotStages.get(target.id);
  if (!stage)
    throw new Error(
      input.promptLocale === "en-US"
        ? `Plot stage ${target.id} was not found. Read kind=workspace, id=workspace for current ids.`
        : `不存在剧情结构 ${target.id}。请用 read（kind=workspace，id=workspace）查询最新 id。`
    );
  if (stage.provisional) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "A pending plot stage cannot be renamed in the same run. Use its final information in create."
        : "待创建剧情结构不能在同一轮改名，请在 create 时直接使用目标信息。"
    );
  }
  const title = meta.title?.trim() ?? stage.title;
  const description = meta.description?.trim() ?? stage.description;
  if (!title)
    throw new Error(
      input.promptLocale === "en-US"
        ? "Plot stage title cannot be empty."
        : "剧情结构标题不能为空。"
    );
  if (!description)
    throw new Error(
      input.promptLocale === "en-US"
        ? "Plot stage description cannot be empty."
        : "剧情结构说明不能为空。"
    );
  if (
    [...state.plotStages.values()].some(
      (candidate) =>
        candidate.id !== stage.id &&
        candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
    )
  ) {
    throw new Error(
      input.promptLocale === "en-US"
        ? "A plot stage with that title already exists."
        : "已存在同名剧情结构。"
    );
  }
  if (title === stage.title && description === stage.description)
    return unchanged(input);
  const allowed = await confirmPlotStructureChange(input, state, {
    ...request,
    change:
      title === stage.title
        ? input.promptLocale === "en-US"
          ? `change the description of plot stage “${stage.title}”`
          : `修改剧情结构《${stage.title}》的说明`
        : input.promptLocale === "en-US"
          ? `rename plot stage “${stage.title}” to “${title}”`
          : `把剧情结构《${stage.title}》改名为《${title}》`
  });
  if (!allowed) return plotStructureChangeDeclined(input);
  return trackWritingMutation(input, state, () => {
    state.plotStages.set(stage.id, { ...stage, title, description });
    const summary = rawSummary.trim();
    return textResult(shortProposalSummary(input, summary), {
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
  });
}

export async function formShortMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  summary: string,
  request: { toolCallId: string; signal?: AbortSignal }
) {
  if (
    target.kind !== "draft_section" &&
    (meta.after_id !== undefined || meta.word_count_requirement !== undefined)
  )
    throw new Error(
      input.promptLocale === "en-US"
        ? "after_id and word_count_requirement apply only to draft_section."
        : "只有 draft_section 支持 after_id 和 word_count_requirement。"
    );
  if (target.kind === "character_overview") {
    throw new Error(
      input.promptLocale === "en-US"
        ? "The character overview does not support meta edits."
        : "人物概览不支持 meta 修改。"
    );
  }
  if (target.kind === "character") {
    return characterMetaProposal(input, state, target, meta, summary);
  }
  if (target.kind === "plot_stage") {
    return plotStageMetaProposal(input, state, target, meta, summary, request);
  }
  return draftMetaProposal(input, state, target, meta, summary);
}
