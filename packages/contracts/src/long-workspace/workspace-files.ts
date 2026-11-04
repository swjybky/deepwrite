import type { LongWorkspaceRoot } from "./agents";
import type { LongWorkspaceFileReference } from "./ids";
import type { LongWorkspaceIndexSnapshot } from "./index-validation";

export interface LongIndexedFile {
  file: LongWorkspaceFileReference;
  root: LongWorkspaceRoot;
  title: string;
}

/** Every text file of a long-form work, titled for people and agents. */
export function listLongWorkspaceFiles(
  index: LongWorkspaceIndexSnapshot
): LongIndexedFile[] {
  const characterById = new Map(
    index.characters.map((character) => [character.id, character])
  );
  const chapterById = new Map(
    index.plot.chapterCards.map((chapter) => [chapter.id, chapter])
  );
  return [
    {
      file: index.bookLine,
      root: "plot_design",
      title: "全书主线"
    },
    ...index.worldbuilding.flatMap((category) =>
      category.format === "text"
        ? [
            {
              file: category.file,
              root: "worldbuilding" as const,
              title: category.title
            }
          ]
        : [
            ...(category.overview
              ? [
                  {
                    file: category.overview,
                    root: "worldbuilding" as const,
                    title: `${category.title} / 概览`
                  }
                ]
              : []),
            ...category.items.map((item) => ({
              file: item.file,
              root: "worldbuilding" as const,
              title: `${category.title} / ${item.title}`
            }))
          ]
    ),
    ...(index.characterOverview
      ? [
          {
            file: index.characterOverview,
            root: "character_design" as const,
            title: "人物概览"
          }
        ]
      : []),
    ...index.characterFiles.flatMap((entry) => {
      const title =
        characterById.get(entry.characterId)?.name ?? entry.characterId;
      return [
        {
          file: entry.coreProfile,
          root: "character_design" as const,
          title: `${title} · 核心档案`
        },
        {
          file: entry.relationships,
          root: "character_design" as const,
          title: `${title} · 人物关系`
        }
      ];
    }),
    ...index.chapters.flatMap((entry) => {
      const title =
        chapterById.get(entry.chapterCardId)?.title ?? entry.chapterCardId;
      return [
        {
          file: entry.body,
          root: "draft" as const,
          title: `${title} · 正文`
        },
        {
          file: entry.card,
          root: "plot_design" as const,
          title: `${title} · 章卡`
        },
        {
          file: entry.characterState,
          root: "draft" as const,
          title: `${title} · 人物状态`
        },
        {
          file: entry.handoff,
          root: "draft" as const,
          title: `${title} · 交接`
        },
        {
          file: entry.foreshadowingChanges,
          root: "continuity_ledger" as const,
          title: `${title} · 伏笔变化`
        },
        ...(entry.worldReveals
          ? [
              {
                file: entry.worldReveals,
                root: "continuity_ledger" as const,
                title: `${title} · 世界观揭露`
              }
            ]
          : []),
        ...entry.characterContinuity.flatMap((continuity) => {
          const characterTitle =
            characterById.get(continuity.characterId)?.name ??
            continuity.characterId;
          return [
            {
              file: continuity.currentState,
              root: "continuity_ledger" as const,
              title: `${title} · ${characterTitle} · 当前状态`
            },
            {
              file: continuity.history,
              root: "continuity_ledger" as const,
              title: `${title} · ${characterTitle} · 历史轨迹`
            }
          ];
        })
      ];
    }),
    ...index.plot.storyPlots.map((entry) => ({
      file: entry.file,
      root: "plot_design" as const,
      title: entry.title
    })),
    ...index.ledger.commits.map((commit) => ({
      file: commit.recordFile,
      root: "continuity_ledger" as const,
      title: `提交 ${commit.sequence} · ${commit.chapterCardId}`
    }))
  ];
}
