import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongChapterCardId
} from "@deepwrite/contracts";
import type {
  LongWorkspaceSelection,
  LongWorkspaceSelectionFile
} from "./longWorkspace";
import { indexedVolume, indexedChapterCard } from "./longIndexedChapter";

/**
 * Keeps chapter authoring and continuity review as two distinct entry points.
 * Evidence stays read-only; continuity outputs are editable until committed;
 * the internal commit JSON is never part of the visible selection.
 */
export function createLongContinuitySelection(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId
): LongWorkspaceSelection | undefined {
  const chapter = indexedChapterCard(summary, workspaceIndex, chapterCardId);
  const volume = chapter
    ? indexedVolume(summary, workspaceIndex, chapter.volumeId)
    : undefined;
  const entry = workspaceIndex.chapters.find(
    (candidate) => candidate.chapterCardId === chapterCardId
  );
  if (!chapter || !volume || !entry) {
    return undefined;
  }
  const committed = entry.commitId !== null;
  const commit = committed
    ? workspaceIndex.ledger.commits.find(({ id }) => id === entry.commitId)
    : undefined;
  const importCheckpoint = commit?.mode === "import_checkpoint";
  if (!committed && entry.bodyStatus !== "written") {
    return undefined;
  }
  const characterNameById = new Map(
    summary.navigation.characters.map(({ id, name }) => [id, name] as const)
  );
  const characterContinuityFiles = [...(entry.characterContinuity ?? [])]
    .sort((left, right) =>
      (
        characterNameById.get(left.characterId) ?? left.characterId
      ).localeCompare(
        characterNameById.get(right.characterId) ?? right.characterId,
        "zh-CN"
      )
    )
    .flatMap<LongWorkspaceSelectionFile>((character) => {
      const name =
        characterNameById.get(character.characterId) ?? character.characterId;
      return [
        {
          role: "current-state",
          label: `${name} · 当前状态`,
          file: character.currentState,
          readOnly: committed
        },
        {
          role: "history",
          label: `${name} · 历史轨迹`,
          file: character.history,
          readOnly: committed
        }
      ];
    });
  return {
    key: `continuity:${chapter.id}`,
    root: "continuity_ledger",
    continuityView: committed ? "history" : "inbox",
    chapterCardId: chapter.id,
    title: chapter.title || chapter.id,
    breadcrumbs: [
      summary.title,
      "连续性账本",
      volume.title,
      chapter.title || chapter.id
    ],
    files: [
      {
        role: "body",
        label: "正文证据",
        file: entry.body,
        readOnly: true
      },
      ...(importCheckpoint ? [] : characterContinuityFiles),
      ...(entry.worldReveals && !importCheckpoint
        ? [
            {
              role: "world-reveals" as const,
              label: "世界观揭露",
              file: entry.worldReveals,
              readOnly: committed
            }
          ]
        : []),
      ...(!importCheckpoint
        ? [
            {
              role: "foreshadowing-changes" as const,
              label: "伏笔变化",
              file: entry.foreshadowingChanges,
              readOnly: committed
            }
          ]
        : []),
      ...(importCheckpoint
        ? []
        : [
            {
              role: "character-state" as const,
              label: "章末状态",
              file: entry.characterState,
              readOnly: committed
            },
            {
              role: "handoff" as const,
              label: "接续包",
              file: entry.handoff,
              readOnly: committed
            }
          ])
    ],
    preferredRole: "body",
    description: importCheckpoint
      ? "续写导入检查点仅表示历史正文已封存，不代表已经生成连续性事实、章末状态或接续包。"
      : committed
        ? "按章保留正文证据、人物状态与历史、世界观揭露、既有伏笔触点变化、章末状态和接续包。"
        : "待处理章节；伏笔只核验总览中已关联本章的既有触点，没有候选时不生成伏笔记录。"
  };
}
