import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongVolumeId,
  LongChapterCardId
} from "@deepwrite/contracts";

export function indexedVolume(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  volumeId: LongVolumeId
) {
  return (
    summary.navigation.volumes.find(({ id }) => id === volumeId) ??
    workspaceIndex.plot.volumes?.find(({ id }) => id === volumeId)
  );
}

export function indexedChapterCard(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId
) {
  return (
    summary.navigation.chapterCards.find(({ id }) => id === chapterCardId) ??
    workspaceIndex.plot.chapterCards?.find(({ id }) => id === chapterCardId)
  );
}
