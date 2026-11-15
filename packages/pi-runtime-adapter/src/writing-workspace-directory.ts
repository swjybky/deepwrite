import { countWritingContentCharacters } from "./writing-content-counts";
import type { PromptLocale } from "@deepwrite/contracts";
import type {
  ShortWorkspaceToolSharedState,
  WritingWorkspaceSnapshot
} from "./short-agent-tools/shared";

/** Project the run's live directory without changing its original snapshot. */
export function currentWritingWorkspaceNavigation<
  Workspace extends WritingWorkspaceSnapshot
>(workspace: Workspace, state: ShortWorkspaceToolSharedState): Workspace {
  return {
    ...workspace,
    coreFiles: state.coreFiles,
    characterStructure:
      workspace.characterStructure.format === "list"
        ? {
            format: "list",
            items: state.characterItemOrder.flatMap((id, index) => {
              const item = state.characterItems.get(id);
              return item ? [{ ...item, order: index + 1 }] : [];
            })
          }
        : workspace.characterStructure,
    stages: [...state.stageBodies].map(([stageId, content]) => {
      const snapshot = workspace.stages.find(
        (stage) => stage.stageId === stageId
      );
      return {
        ...snapshot,
        stageId,
        title:
          state.plotStages.get(stageId)?.title ?? snapshot?.title ?? stageId,
        revision: state.stageRevisions.get(stageId)!,
        content
      };
    }),
    plotStages: state.plotStageOrder.flatMap((id) => {
      const stage = state.plotStages.get(id);
      return stage ? [{ ...stage }] : [];
    }),
    expertDraft: {
      ...workspace.expertDraft,
      sections: state.expertSectionOrder.flatMap((id) => {
        const section = state.expertSections.get(id);
        return section ? [section] : [];
      })
    }
  };
}

function contentStatus(
  workspace: WritingWorkspaceSnapshot,
  file:
    | {
        content: string;
        revision: string;
        id?: string;
        stageId?: string;
        documentId?: string;
        truncated?: boolean | undefined;
      }
    | undefined,
  english: boolean
): string {
  if (
    workspace.readSource === "core" &&
    (!workspace.coreFiles || file?.revision === "unloaded")
  )
    return english ? "read on demand" : "按需读取";
  const metrics = workspace.coreFiles?.get(
    file?.documentId ?? file?.stageId ?? file?.id ?? ""
  );
  const count =
    metrics && metrics.revision === file?.revision
      ? metrics.characters
      : countWritingContentCharacters(file?.content ?? "");
  if (file?.truncated)
    return english
      ? `${count} characters shown (partial)`
      : `已返回 ${count} 字（截断）`;
  if (!count) return english ? "empty" : "空白";
  return english ? `${count} characters` : `${count} 字`;
}

function temporaryLabel(
  item: { id: string; provisional?: boolean },
  english: boolean
): string {
  return item.provisional || item.id.startsWith("pending:")
    ? english
      ? " [provisional id]"
      : "［临时 id］"
    : "";
}

function renderCreativePlotStructure(
  workspace: WritingWorkspaceSnapshot,
  english: boolean
): string {
  return workspace.plotStages
    .map((stage, index) =>
      english
        ? `${index + 1}. ${stage.title} (kind=plot_stage, id=${stage.id})${temporaryLabel(stage, true)} · ${contentStatus(
            workspace,
            workspace.stages.find((item) => item.stageId === stage.id),
            true
          )}\n   Scope and delivery standard: ${stage.description}`
        : `${index + 1}. ${stage.title}（kind=plot_stage，id=${stage.id}）${temporaryLabel(stage, false)} · ${contentStatus(
            workspace,
            workspace.stages.find((item) => item.stageId === stage.id),
            false
          )}\n   阶段边界与交付标准：${stage.description}`
    )
    .join("\n");
}

function renderEnglishDirectory(
  workspace: WritingWorkspaceSnapshot,
  script: boolean
): string {
  const structure = workspace.characterStructure;
  return [
    "[Work object directory]",
    "Read objects by the stable ids in this directory; never use a name or title as an id. The directory includes objects created this turn, which does not mean their proposals are saved. Saved ids may differ from provisional ids. After creating, renaming or deleting, call read (kind=workspace, id=workspace) to get the latest directory.",
    `Character overview: kind=character_overview, id=character_design · ${contentStatus(
      workspace,
      workspace.stages.find((stage) => stage.stageId === "character_design"),
      true
    )}`,
    ...(structure.format === "list"
      ? [
          "Individual character cards use kind=character with ids from the character index.",
          `Character index: ${
            structure.items.length
              ? structure.items
                  .map(
                    (item) =>
                      `${item.title} (${item.id})${temporaryLabel(item, true)} · ${contentStatus(workspace, item, true)}`
                  )
                  .join(", ")
              : "none"
          }`
        ]
      : [
          "Characters use the text layout: every character lives in the character overview (kind=character_overview, id=character_design)."
        ]),
    "",
    "[Plot structure (listed in working order)]",
    "Plot stages use kind=plot_stage with the ids below.",
    renderCreativePlotStructure(workspace, true),
    "",
    "Manuscript directory: kind=draft, id=draft",
    `Each ${script ? "episode" : "section"} uses kind=draft_section and its id. Select document=body for the manuscript or document=state for State (character, plot, emotional or other continuity notes).`,
    ...(workspace.expertDraft.sections.length
      ? workspace.expertDraft.sections.map(
          (section, index) =>
            `${index + 1}. ${section.title} (${section.id})${temporaryLabel(section, true)} · Body ${contentStatus(workspace, section.body, true)} · State ${contentStatus(workspace, section.characterState, true)}; length target: ${section.wordCountRequirement || "not set"}`
        )
      : ["none"])
  ].join("\n");
}

/** Metadata only: discovering an id never grants full-read edit evidence. */
export function renderWritingWorkspaceDirectory(
  workspace: WritingWorkspaceSnapshot,
  locale?: PromptLocale,
  workspaceType: "short" | "script" = "short"
): string {
  if (locale === "en-US")
    return renderEnglishDirectory(workspace, workspaceType === "script");
  const structure = workspace.characterStructure;
  return [
    "【当前作品对象目录】",
    "使用目录中的稳定 id 读取，不要把人名或标题当作 id。目录包含本轮新建对象，不代表提案已经落盘。临时 id 保存后可能改变。新建、改名或删除后，可用 read（kind=workspace，id=workspace）重新获取最新目录。",
    `人物概览：kind=character_overview，id=character_design · ${contentStatus(
      workspace,
      workspace.stages.find((stage) => stage.stageId === "character_design"),
      false
    )}`,
    ...(structure.format === "list"
      ? ["独立人物卡使用 kind=character 与人物条目索引中的 id。"]
      : []),
    structure.format === "list"
      ? `人物条目索引：${
          structure.items.length
            ? structure.items
                .map(
                  (item) =>
                    `${item.title} (${item.id})${temporaryLabel(item, false)} · ${contentStatus(workspace, item, false)}`
                )
                .join("、")
            : "无"
        }`
      : "人物为文本样式：全部人物写在人物总稿（kind=character_overview，id=character_design）。",
    "",
    "【当前剧情结构配置（顺序即执行顺序）】",
    "剧情结构使用 kind=plot_stage 与对应 id。",
    renderCreativePlotStructure(workspace, false),
    "",
    "正文目录：kind=draft，id=draft",
    `各${workspaceType === "script" ? "剧集" : "小节"}使用 kind=draft_section 与对应 id；正文用 document=body，状态用 document=state，可记录人物、剧情、情感等任何需要延续的信息。`,
    ...(workspace.expertDraft.sections.length
      ? workspace.expertDraft.sections.map(
          (section, index) =>
            `${index + 1}. ${section.title} (${section.id})${temporaryLabel(section, false)} · 正文 ${contentStatus(workspace, section.body, false)} · 状态 ${contentStatus(workspace, section.characterState, false)}；字数要求：${section.wordCountRequirement || "未设置"}`
        )
      : ["无"])
  ].join("\n");
}
