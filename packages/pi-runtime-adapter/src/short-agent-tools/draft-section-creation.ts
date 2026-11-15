import {
  PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  type ExpertDraftSectionSnapshot
} from "@deepwrite/contracts";
import { appendWritingContentCounts } from "../writing-content-counts";
import { draftBodyFeedback } from "./draft-feedback";
import { shortProposalSummary } from "./unified-proposal";
import { trackWritingMutation } from "./settlement";
import {
  draftUnitLabel,
  textResult,
  provisionalIdHint,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolSharedState
} from "./shared";

function draftSectionSnapshot(
  input: BuildWritingWorkspaceToolsInput,
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
      title:
        input.promptLocale === "en-US" ? `${title} · State` : `${title} · 状态`,
      content: characterStateContent,
      revision: createShortWorkspaceContentRevision(characterStateContent)
    }
  };
}

interface SectionInput {
  title: string;
  word_count_requirement?: string;
  content?: string;
  state?: string;
}

export function draftSectionCreation(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  items: readonly SectionInput[],
  afterId: string | undefined,
  summary: string
) {
  const english = input.promptLocale === "en-US";
  if (!items.length || state.expertSectionOrder.length + items.length > 100)
    throw new Error(
      english
        ? "Supply at least one item; the directory supports at most 100."
        : "至少创建一项，正文目录最多支持 100 项。"
    );
  const titles = new Set(
    [...state.expertSections.values()].map((item) =>
      item.title.toLocaleLowerCase()
    )
  );
  const index =
    afterId === undefined
      ? state.expertSectionOrder.length
      : state.expertSectionOrder.indexOf(afterId) + 1;
  if (afterId !== undefined && !index)
    throw new Error(
      english
        ? `Insertion target ${afterId} was not found. Read kind=workspace, id=workspace for current ids.`
        : `找不到插入位置 ${afterId}。请用 read（kind=workspace，id=workspace）查询最新 id。`
    );
  const prepared = items.map((item, offset) => {
    const title = item.title.trim();
    if (!title)
      throw new Error(english ? "A title cannot be empty." : "标题不能为空。");
    if (titles.has(title.toLocaleLowerCase()))
      throw new Error(
        english
          ? `A ${draftUnitLabel(input)} with that title already exists: ${title}.`
          : `正文目录已存在同名${draftUnitLabel(input)}《${title}》。`
      );
    titles.add(title.toLocaleLowerCase());
    return draftSectionSnapshot(
      input,
      `${PROVISIONAL_EXPERT_DRAFT_SECTION_ID_PREFIX}${state.pendingSectionSeq + offset + 1}`,
      title,
      item.word_count_requirement?.trim() ?? "",
      item.content ?? "",
      item.state ?? ""
    );
  });
  return trackWritingMutation(input, state, () => {
    for (const section of prepared)
      state.expertSections.set(section.id, section);
    state.pendingSectionSeq += prepared.length;
    state.expertSectionOrder.splice(
      index,
      0,
      ...prepared.map((section) => section.id)
    );
    const lines = prepared.map((section) => {
      const counts = appendWritingContentCounts(
        `section_id=${section.id}`,
        [
          {
            title: `${section.title} · ${english ? "Body" : "正文"}`,
            id: section.body.documentId,
            content: section.body.content
          },
          {
            title: section.characterState.title,
            id: section.characterState.documentId,
            content: section.characterState.content
          }
        ],
        input.promptLocale
      );
      return [
        counts,
        draftBodyFeedback(
          input,
          section.body.content,
          section.wordCountRequirement
        )
      ]
        .filter(Boolean)
        .join("\n");
    });
    return textResult(
      [
        shortProposalSummary(input, summary),
        provisionalIdHint(input),
        ...lines
      ].join("\n"),
      {
        kind: "workspace-expert-draft-section-creation",
        workspaceId: input.workspace.id,
        stageId: "draft",
        sections: prepared.map((section) => ({
          provisionalSectionId: section.id,
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          ...(section.body.content
            ? { bodyContent: section.body.content }
            : {}),
          ...(section.characterState.content
            ? { characterStateContent: section.characterState.content }
            : {})
        })),
        ...(afterId ? { afterSectionId: afterId } : {}),
        baseRevision: state.expertDraftDirectoryBaseRevision,
        summary
      }
    );
  });
}
