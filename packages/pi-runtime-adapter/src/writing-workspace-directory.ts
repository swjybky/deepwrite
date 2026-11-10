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

function renderCreativePlotStructure(
  workspace: WritingWorkspaceSnapshot,
  english: boolean
): string {
  return workspace.plotStages
    .map((stage, index) =>
      english
        ? `${index + 1}. ${stage.title} (${stage.id})\n   Scope and delivery standard: ${stage.description}`
        : `${index + 1}. ${stage.title}（${stage.id}）\n   阶段边界与交付标准：${stage.description}`
    )
    .join("\n");
}

function renderEnglishDirectory(workspace: WritingWorkspaceSnapshot): string {
  const structure = workspace.characterStructure;
  return [
    "[Work object directory]",
    "Read objects by the stable ids in this directory; never use a name or title as an id. The directory includes objects created this turn, which does not mean their proposals are saved. After creating, renaming or deleting, call read (kind=workspace, id=workspace) to get the latest directory.",
    "Character overview: kind=character_overview, id=character_design",
    ...(structure.format === "list"
      ? [
          "Individual character cards use kind=character with ids from the character index.",
          `Character index: ${
            structure.items.length
              ? structure.items
                  .map((item) => `${item.title} (${item.id})`)
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
    "Each section uses kind=draft_section with its id; pass document=body for the prose and document=character_state for the character state.",
    ...(workspace.expertDraft.sections.length
      ? workspace.expertDraft.sections.map(
          (section, index) =>
            `${index + 1}. ${section.title} (${section.id}); length target: ${section.wordCountRequirement || "not set"}`
        )
      : ["none"])
  ].join("\n");
}

/** Metadata only: discovering an id never grants full-read edit evidence. */
export function renderWritingWorkspaceDirectory(
  workspace: WritingWorkspaceSnapshot,
  locale?: PromptLocale
): string {
  if (locale === "en-US") return renderEnglishDirectory(workspace);
  const structure = workspace.characterStructure;
  return [
    "【当前作品对象目录】",
    "使用目录中的稳定 id 读取，不要把人名或标题当作 id。目录包含本轮新建对象，不代表提案已经落盘。新建、改名或删除后，可用 read（kind=workspace，id=workspace）重新获取最新目录。",
    "人物概览：kind=character_overview，id=character_design",
    ...(structure.format === "list"
      ? ["独立人物卡使用 kind=character 与人物条目索引中的 id。"]
      : []),
    structure.format === "list"
      ? `人物条目索引：${
          structure.items.length
            ? structure.items
                .map((item) => `${item.title} (${item.id})`)
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
    "各小节使用 kind=draft_section 与对应 id；读取正文指定 document=body，读取人物状态指定 document=character_state。",
    ...(workspace.expertDraft.sections.length
      ? workspace.expertDraft.sections.map(
          (section, index) =>
            `${index + 1}. ${section.title} (${section.id})；字数要求：${section.wordCountRequirement || "未设置"}`
        )
      : ["无"])
  ].join("\n");
}
