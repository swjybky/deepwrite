import type {
  LongBookSummary,
  LongWorkspaceFileReference,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";

export function file(id: string, path: string): LongWorkspaceFileReference {
  return {
    id,
    path,
    updatedAt: "2026-07-26T12:00:00.000Z"
  };
}

export function fixture(commitId: string | null): {
  summary: LongBookSummary;
  workspaceIndex: LongWorkspaceIndexSnapshot;
} {
  const summary = {
    id: "longbook_lifecycle",
    title: "长篇生命周期",
    navigation: {
      volumes: [{ id: "volume_one", title: "第一卷", order: 1 }],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          title: "第一章",
          narrativeOrder: 1,
          bodyStatus: "written"
        }
      ],
      characters: [],
      arcs: [
        {
          id: "arc_one",
          volumeId: "volume_one",
          title: "剧情点一",
          order: 1
        },
        {
          id: "arc_two",
          volumeId: "volume_one",
          title: "剧情点二",
          order: 2
        }
      ]
    }
  } as unknown as LongBookSummary;
  const workspaceIndex = {
    bookLine: file("file_plot:book-line", "long/plot/book-line.md"),
    plot: {
      volumes: [
        {
          id: "volume_one",
          title: "第一卷",
          order: 1,
          summary: ""
        }
      ],
      arcs: [
        {
          id: "arc_one",
          volumeId: "volume_one",
          title: "剧情点一",
          order: 1,
          summary: "概要一",
          outline: "故事情节一"
        },
        {
          id: "arc_two",
          volumeId: "volume_one",
          title: "剧情点二",
          order: 2,
          summary: "概要二",
          outline: "故事情节二"
        }
      ],
      chapterCards: [
        {
          id: "chapter_one",
          volumeId: "volume_one",
          narrativeOrder: 1
        }
      ]
    },
    ledger: {
      commits: commitId
        ? [
            {
              id: commitId,
              mode: "structured",
              sequence: 1,
              chapterCardId: "chapter_one"
            }
          ]
        : []
    },
    chapters: [
      {
        chapterCardId: "chapter_one",
        bodyStatus: "written",
        body: file("file_chapter_body", "long/chapters/chapter_one/body.md"),
        card: file("file_chapter_card", "long/chapters/chapter_one/card.md"),
        characterState: file(
          "file_chapter_state",
          "long/chapters/chapter_one/character-state.md"
        ),
        handoff: file(
          "file_chapter_handoff",
          "long/chapters/chapter_one/handoff.md"
        ),
        foreshadowingChanges: file(
          "file_chapter_foreshadowing",
          "long/chapters/chapter_one/continuity/foreshadowing-changes.md"
        ),
        worldReveals: null,
        characterContinuity: [],
        commitId
      }
    ]
  } as unknown as LongWorkspaceIndexSnapshot;
  return { summary, workspaceIndex };
}
