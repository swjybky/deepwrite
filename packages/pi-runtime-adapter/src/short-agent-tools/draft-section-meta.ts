import {
  isProvisionalExpertDraftSectionId,
  type DraftSectionChange
} from "@deepwrite/contracts";
import { trackWritingMutation } from "./settlement";
import {
  draftUnitLabel,
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";
import { shortProposalSummary, unchanged } from "./unified-proposal";
import type { ShortUnifiedTarget } from "./unified-target";
import type { EditMeta } from "./unified-edit-meta";

export function draftMetaProposal(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  target: ShortUnifiedTarget,
  meta: EditMeta,
  rawSummary: string
) {
  return trackWritingMutation(input, state, () => {
    if (meta.description !== undefined || Object.keys(meta).length !== 1) {
      throw new Error(
        input.promptLocale === "en-US"
          ? `${draftUnitLabel(input)} meta requires exactly one of title, word_count_requirement, move or after_id.`
          : `${draftUnitLabel(input)} meta 必须且只能选择 title、word_count_requirement、move 或 after_id。`
      );
    }
    const section = state.expertSections.get(target.sectionId!);
    if (!section) {
      throw new Error(
        input.promptLocale === "en-US"
          ? `The ${draftUnitLabel(input)} ${target.id} was not found. Read kind=workspace, id=workspace for current ids.`
          : `不存在${draftUnitLabel(input)} ${target.id}。请用 read（kind=workspace，id=workspace）查询最新 id。`
      );
    }
    if (
      meta.title !== undefined &&
      isProvisionalExpertDraftSectionId(section.id)
    ) {
      throw new Error(
        input.promptLocale === "en-US"
          ? `A pending ${draftUnitLabel(input)} cannot be renamed in the same run. Set its title in create.`
          : `待创建${draftUnitLabel(input)}不能在同一轮改名，请在 create 时设置目标标题。`
      );
    }
    const english = input.promptLocale === "en-US";
    let change: DraftSectionChange | undefined;
    if (meta.word_count_requirement !== undefined) {
      change = {
        field: "wordCountRequirement",
        before: section.wordCountRequirement,
        after: meta.word_count_requirement.trim()
      };
    } else if (meta.move || meta.after_id !== undefined) {
      const order = state.expertSectionOrder;
      const index = order.indexOf(section.id);
      const before = order[index - 1] ?? null;
      let after = meta.after_id?.trim() ?? null;
      if (meta.move === "up") after = order[index - 2] ?? null;
      if (meta.move === "down") after = order[index + 1] ?? before;
      if (after === section.id || (after !== null && !order.includes(after)))
        throw new Error(
          english
            ? "Invalid insertion target. Read kind=workspace, id=workspace for current ids."
            : "插入位置无效，请用 read（kind=workspace，id=workspace）查询最新 id。"
        );
      change = { field: "afterSectionId", before, after };
    }
    if (change) {
      if (change.before === change.after) return unchanged(input);
      if (change.field === "afterSectionId") {
        const order = state.expertSectionOrder;
        order.splice(order.indexOf(section.id), 1);
        order.splice(
          change.after === null ? 0 : order.indexOf(change.after) + 1,
          0,
          section.id
        );
      } else
        state.expertSections.set(section.id, {
          ...section,
          wordCountRequirement: change.after
        });
      const summary = rawSummary.trim();
      return textResult(shortProposalSummary(input, summary), {
        kind: "workspace-expert-draft-section-rename",
        workspaceId: input.workspace.id,
        stageId: "draft",
        sectionId: section.id,
        title: section.title,
        previousTitle: section.title,
        change,
        baseRevision: state.expertDraftDirectoryBaseRevision,
        summary
      });
    }
    const title = meta.title?.trim() ?? "";
    if (!title)
      throw new Error(
        input.promptLocale === "en-US"
          ? `${draftUnitLabel(input)} title cannot be empty.`
          : `${draftUnitLabel(input)}标题不能为空。`
      );
    if (
      [...state.expertSections.values()].some(
        (candidate) =>
          candidate.id !== section.id &&
          candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase()
      )
    ) {
      throw new Error(
        input.promptLocale === "en-US"
          ? `A ${draftUnitLabel(input)} with that title already exists.`
          : `正文目录已存在同名${draftUnitLabel(input)}。`
      );
    }
    if (title === section.title) return unchanged(input);
    const previousTitle = section.title;
    state.expertSections.set(section.id, {
      ...section,
      title,
      body: { ...section.body, title },
      characterState: {
        ...section.characterState,
        title:
          input.promptLocale === "en-US"
            ? `${title} · State`
            : `${title} · 状态`
      }
    });
    const summary = rawSummary.trim();
    return textResult(shortProposalSummary(input, summary), {
      kind: "workspace-expert-draft-section-rename",
      workspaceId: input.workspace.id,
      stageId: "draft",
      sectionId: section.id,
      previousTitle,
      title,
      baseRevision: state.expertDraftDirectoryBaseRevision,
      summary
    });
  });
}
