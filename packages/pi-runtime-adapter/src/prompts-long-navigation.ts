import type {
  LongPlotFocusSnapshot,
  LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";

const LONG_PLOT_NAVIGATION_ARC_LIMIT_PER_VOLUME = 50;
const LONG_PLOT_NAVIGATION_CHAPTERS_BEFORE_ACTIVE = 3;
const LONG_PLOT_NAVIGATION_CHAPTERS_AFTER_ACTIVE = 10;

export function renderLongPlotNavigation(
  navigation: LongWorkspaceRuntimeContext["navigation"],
  activeChapterCardId?: string
): string {
  const counts = navigation.counts;
  const header =
    `全书共 ${counts.volumes} 卷、${counts.arcs} 个剧情点、` +
    `${counts.chapterCards} 张章卡、${counts.storyPlots} 条故事情节、` +
    `${counts.storyEvents} 个故事事件、${counts.foreshadowingThreads} 条伏笔线`;
  const volumes = [...navigation.volumes].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const volumeOrder = new Map(
    volumes.map((volume) => [volume.id, volume.order])
  );
  const orderedChapters = [...navigation.chapterCards].sort(
    (left, right) =>
      (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
        (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
      left.narrativeOrder - right.narrativeOrder ||
      left.id.localeCompare(right.id)
  );
  const writtenChapters = orderedChapters.filter(
    (chapter) => chapter.bodyStatus === "written"
  );
  const committedThrough = navigation.committedThroughChapterId
    ? navigation.chapterCards.find(
        (chapter) => chapter.id === navigation.committedThroughChapterId
      )
    : undefined;
  const bodyStatus = `正文进度：已写 ${writtenChapters.length} 章，空白 ${
    orderedChapters.length - writtenChapters.length
  } 章。`;
  const committedStatus = counts.committedChapters
    ? committedThrough
      ? `连续性记录：${counts.committedChapters} 章；最高连续记录位置为「${committedThrough.title}」(${committedThrough.id})。记录只作参考，不锁定正文或结构。`
      : `连续性记录：${counts.committedChapters} 章；尚未形成从第一章开始的连续记录区间。记录只作参考，不锁定正文或结构。`
    : "连续性记录：0 章。记录不会限制正文写作或结构调整。";
  const lines = volumes.map((volume) => {
    const arcs = navigation.arcs
      .filter((arc) => arc.volumeId === volume.id)
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id)
      );
    const visible = arcs.slice(0, LONG_PLOT_NAVIGATION_ARC_LIMIT_PER_VOLUME);
    const listing = visible.length
      ? visible.map((arc) => `「${arc.title}」(${arc.id})`).join("、")
      : "暂无剧情点";
    const overflow = arcs.length - visible.length;
    return `- 第 ${volume.order} 卷「${volume.title}」(${volume.id}): ${listing}${
      overflow > 0
        ? `；另有 ${overflow} 个剧情点未列出，需要时调用 list（stage=plot, scope_id=${volume.id}）`
        : ""
    }`;
  });
  const activeChapterIndex = activeChapterCardId
    ? orderedChapters.findIndex((chapter) => chapter.id === activeChapterCardId)
    : -1;
  const chapterWindowStart = Math.max(
    0,
    activeChapterIndex - LONG_PLOT_NAVIGATION_CHAPTERS_BEFORE_ACTIVE
  );
  const chapterWindowEnd = Math.min(
    orderedChapters.length,
    activeChapterIndex + LONG_PLOT_NAVIGATION_CHAPTERS_AFTER_ACTIVE + 1
  );
  const fallbackTailStart = Math.max(
    Math.min(
      LONG_PLOT_NAVIGATION_CHAPTERS_BEFORE_ACTIVE,
      orderedChapters.length
    ),
    orderedChapters.length - LONG_PLOT_NAVIGATION_CHAPTERS_AFTER_ACTIVE
  );
  const visibleChapterEntries =
    activeChapterIndex >= 0
      ? orderedChapters
          .slice(chapterWindowStart, chapterWindowEnd)
          .map((chapter, index) => ({
            chapter,
            position: chapterWindowStart + index
          }))
      : [
          ...orderedChapters
            .slice(0, LONG_PLOT_NAVIGATION_CHAPTERS_BEFORE_ACTIVE)
            .map((chapter, position) => ({ chapter, position })),
          ...orderedChapters.slice(fallbackTailStart).map((chapter, index) => ({
            chapter,
            position: fallbackTailStart + index
          }))
        ];
  const arcById = new Map(navigation.arcs.map((arc) => [arc.id, arc] as const));
  const volumeById = new Map(
    navigation.volumes.map((volume) => [volume.id, volume] as const)
  );
  const chapterLines = visibleChapterEntries.length
    ? visibleChapterEntries.map(({ chapter, position }) => {
        const volume = volumeById.get(chapter.volumeId);
        const primaryArc = chapter.primaryArcId
          ? arcById.get(chapter.primaryArcId)
          : undefined;
        return [
          `${position + 1}. 「${chapter.title}」(${chapter.id})`,
          `分卷=${
            volume
              ? `第 ${volume.order} 卷「${volume.title}」(${volume.id})`
              : chapter.volumeId
          }`,
          `卷内顺序=${chapter.narrativeOrder}`,
          `主剧情点=${
            primaryArc ? `「${primaryArc.title}」(${primaryArc.id})` : "未关联"
          }`,
          `正文=${chapter.bodyStatus === "written" ? "已写" : "空白"}`,
          chapter.id === activeChapterCardId ? "当前章=是" : ""
        ]
          .filter(Boolean)
          .join("；");
      })
    : ["- 暂无章卡"];
  const chapterWindowNotice = (() => {
    if (activeChapterIndex >= 0) {
      const omittedBefore = chapterWindowStart;
      const omittedAfter = orderedChapters.length - chapterWindowEnd;
      return omittedBefore > 0 || omittedAfter > 0
        ? `目录窗口：围绕当前章展示第 ${chapterWindowStart + 1}-${chapterWindowEnd} 张（前最多 ${LONG_PLOT_NAVIGATION_CHAPTERS_BEFORE_ACTIVE} 张、后最多 ${LONG_PLOT_NAVIGATION_CHAPTERS_AFTER_ACTIVE} 张）；之前省略 ${omittedBefore} 张，之后省略 ${omittedAfter} 张。需要完整目录时按上下文中的 volume_id 调用 list（stage=draft, scope_id=<volume_id>）查询。`
        : "";
    }
    const omittedMiddle = Math.max(
      0,
      fallbackTailStart -
        Math.min(
          LONG_PLOT_NAVIGATION_CHAPTERS_BEFORE_ACTIVE,
          orderedChapters.length
        )
    );
    return omittedMiddle > 0
      ? `目录窗口：当前未选中章卡，展示最前 ${LONG_PLOT_NAVIGATION_CHAPTERS_BEFORE_ACTIVE} 张与最后 ${LONG_PLOT_NAVIGATION_CHAPTERS_AFTER_ACTIVE} 张；中间省略 ${omittedMiddle} 张。需要完整目录时按上下文中的 volume_id 调用 list（stage=draft, scope_id=<volume_id>）查询。`
      : "";
  })();
  return [
    header,
    "全书故事线入口：book_line",
    bodyStatus,
    committedStatus,
    "【分卷与剧情点】",
    ...lines,
    `【章卡目录（由早到晚；共 ${orderedChapters.length} 张）】`,
    ...chapterLines,
    chapterWindowNotice
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderLongPlotFocus(focus: LongPlotFocusSnapshot): string {
  switch (focus.section) {
    case "book_line":
      return "全书故事线";
    case "foreshadowing":
      return "伏笔总览";
    case "plot_point":
      return focus.arcId
        ? `剧情点「${focus.arcTitle}」(${focus.arcId})，所属分卷「${focus.volumeTitle}」(${focus.volumeId})`
        : `分卷「${focus.volumeTitle}」(${focus.volumeId}) 的剧情点列表，尚未选中具体剧情点`;
    case "chapter_card":
      return focus.chapterCardId
        ? `章卡「${focus.chapterCardTitle}」(${focus.chapterCardId})，所属分卷「${focus.volumeTitle}」(${focus.volumeId})`
        : `分卷「${focus.volumeTitle}」(${focus.volumeId}) 的章卡列表，尚无章卡`;
  }
}
