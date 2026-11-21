import { describe, expect, it } from "vitest";
import type {
  LongForeshadowing,
  LongWorkspaceNavigationSnapshot
} from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { buildLongPlotFocusSnapshot } from "./longPlotAgentContext";

const navigation: LongWorkspaceNavigationSnapshot = {
  schemaVersion: 1,
  bookId: "longbook_plot_focus",
  updatedAt: "2026-07-30T10:00:00.000Z",
  counts: {
    worldbuildingCategories: 0,
    characters: 0,
    volumes: 2,
    arcs: 1,
    chapterCards: 1,
    storyEvents: 0,
    storyPlots: 0,
    foreshadowingThreads: 0,
    committedChapters: 0
  },
  worldbuilding: [],
  characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
  characters: [],
  volumes: [
    { id: "volume_one", title: "第一卷", order: 1 },
    { id: "volume_two", title: "第二卷", order: 2 }
  ],
  arcs: [{ id: "arc_main", volumeId: "volume_one", title: "主线", order: 1 }],
  chapterCards: [
    {
      id: "chapter_one",
      volumeId: "volume_one",
      primaryArcId: "arc_main",
      title: "第一章",
      narrativeOrder: 1,
      bodyStatus: "empty"
    }
  ],
  committedThroughChapterId: null
};

function plotSelection(
  overrides: Partial<LongWorkspaceSelection>
): LongWorkspaceSelection {
  return {
    key: "plot-design:book-line",
    root: "plot_design",
    title: "全书故事线",
    breadcrumbs: ["雾港", "剧情设计", "全书故事线"],
    files: [],
    preferredRole: "book-line",
    ...overrides
  };
}

function foreshadowingThread(index: number): LongForeshadowing {
  return {
    id: `foreshadow_thread_${index}`,
    title: `伏笔线 ${index}`,
    coreQuestion: `核心问题 ${index}`,
    hiddenTruth: `隐藏真相 ${index}`,
    plannedSpan: "cross_volume",
    truthEventId: null,
    expectedReaderEffect: `读者效果 ${index}`,
    status: "planned",
    beats: [
      {
        id: `beat_thread_${index}`,
        type: "plant",
        order: 1,
        eventId: null,
        placementId: null,
        chapterCardId: null,
        plannedScope: `计划范围 ${index}`,
        note: `触点正文 ${index}`,
        status: "planned",
        commitId: null
      }
    ]
  };
}

describe("long plot agent context", () => {
  it("captures book-line and a lightweight foreshadowing directory", () => {
    expect(
      buildLongPlotFocusSnapshot({
        selection: plotSelection({}),
        navigation
      })
    ).toEqual({ section: "book_line" });
    expect(
      buildLongPlotFocusSnapshot({
        selection: plotSelection({
          key: "plot-design:foreshadowing",
          title: "伏笔总览"
        }),
        navigation,
        foreshadowing: [foreshadowingThread(1)],
        foreshadowingFocus: {
          threadId: "foreshadow_thread_1",
          beatId: "beat_thread_1"
        }
      })
    ).toEqual({
      section: "foreshadowing",
      foreshadowingDirectory: {
        totalCount: 1,
        omittedCount: 0,
        entries: [
          {
            foreshadowingId: "foreshadow_thread_1",
            title: "伏笔线 1",
            status: "planned",
            plannedSpan: "cross_volume",
            beatCount: 1
          }
        ]
      },
      foreshadowingThreadId: "foreshadow_thread_1",
      foreshadowingBeatId: "beat_thread_1"
    });
  });

  it("caps the directory at 100 entries while retaining an out-of-range focus", () => {
    const foreshadowing = Array.from({ length: 101 }, (_, index) =>
      foreshadowingThread(index + 1)
    );
    const snapshot = buildLongPlotFocusSnapshot({
      selection: plotSelection({
        key: "plot-design:foreshadowing",
        title: "伏笔总览"
      }),
      navigation,
      foreshadowing,
      foreshadowingFocus: {
        threadId: "foreshadow_thread_101",
        beatId: "beat_thread_101"
      }
    });

    expect(snapshot?.foreshadowingDirectory).toMatchObject({
      totalCount: 101,
      omittedCount: 1
    });
    expect(snapshot?.foreshadowingDirectory?.entries).toHaveLength(100);
    expect(snapshot?.foreshadowingDirectory?.entries.at(-1)).toMatchObject({
      foreshadowingId: "foreshadow_thread_101"
    });
    expect(snapshot).not.toHaveProperty(
      "foreshadowingDirectory.entries.0.hiddenTruth"
    );
    expect(snapshot).not.toHaveProperty(
      "foreshadowingDirectory.entries.0.beats"
    );
  });

  it("drops stale thread and beat focus ids after data refresh", () => {
    expect(
      buildLongPlotFocusSnapshot({
        selection: plotSelection({
          key: "plot-design:foreshadowing",
          title: "伏笔总览"
        }),
        navigation,
        foreshadowing: [foreshadowingThread(1)],
        foreshadowingFocus: {
          threadId: "foreshadow_thread_1",
          beatId: "beat_missing"
        }
      })
    ).toEqual({
      section: "foreshadowing",
      foreshadowingDirectory: {
        totalCount: 1,
        omittedCount: 0,
        entries: [
          {
            foreshadowingId: "foreshadow_thread_1",
            title: "伏笔线 1",
            status: "planned",
            plannedSpan: "cross_volume",
            beatCount: 1
          }
        ]
      },
      foreshadowingThreadId: "foreshadow_thread_1"
    });
  });

  it("captures the focused plot point with its volume", () => {
    expect(
      buildLongPlotFocusSnapshot({
        selection: plotSelection({
          key: "plot-design:plot-points:volume_one",
          plotPointVolumeId: "volume_one",
          plotPointId: "arc_main",
          title: "主线"
        }),
        navigation
      })
    ).toEqual({
      section: "plot_point",
      volumeId: "volume_one",
      volumeTitle: "第一卷",
      arcId: "arc_main",
      arcTitle: "主线"
    });
  });

  it("captures an empty volume plot-point list without an arc", () => {
    expect(
      buildLongPlotFocusSnapshot({
        selection: plotSelection({
          key: "plot-design:plot-points:volume_two",
          plotPointVolumeId: "volume_two",
          title: "第二卷"
        }),
        navigation
      })
    ).toEqual({
      section: "plot_point",
      volumeId: "volume_two",
      volumeTitle: "第二卷"
    });
  });

  it("captures the focused chapter card with its volume", () => {
    expect(
      buildLongPlotFocusSnapshot({
        selection: plotSelection({
          key: "chapter:chapter_one",
          root: "draft",
          chapterCardId: "chapter_one",
          title: "第一章",
          files: [
            {
              role: "card",
              label: "章卡",
              file: {
                id: "file_card",
                path: "long/chapters/chapter_one/card.md",
                updatedAt: navigation.updatedAt
              }
            }
          ]
        }),
        navigation,
        activeFileId: "file_card"
      })
    ).toEqual({
      section: "chapter_card",
      volumeId: "volume_one",
      volumeTitle: "第一卷",
      chapterCardId: "chapter_one",
      chapterCardTitle: "第一章"
    });
  });

  it("skips other roots and unknown volumes", () => {
    expect(
      buildLongPlotFocusSnapshot({
        selection: null,
        navigation
      })
    ).toBeUndefined();
    expect(
      buildLongPlotFocusSnapshot({
        selection: plotSelection({
          key: "plot-design:plot-points:volume_missing",
          plotPointVolumeId: "volume_missing"
        }),
        navigation
      })
    ).toBeUndefined();
  });
});
