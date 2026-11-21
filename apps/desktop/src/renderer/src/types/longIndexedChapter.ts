import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongVolumeId,
  LongChapterCardId
} from "@deepwrite/contracts";

type ChapterCard =
  | LongBookSummary["navigation"]["chapterCards"][number]
  | LongWorkspaceIndexSnapshot["plot"]["chapterCards"][number];

/** One projection owns these indexes; snapshots are never cached by identity. */
export function createLongChapterLookup(
  summary: LongBookSummary,
  index: LongWorkspaceIndexSnapshot
) {
  const volumes = new Map([
    ...index.plot.volumes.map((volume) => [volume.id, volume] as const),
    ...summary.navigation.volumes.map((volume) => [volume.id, volume] as const)
  ]);
  const cards = new Map([
    ...index.plot.chapterCards.map((card) => [card.id, card] as const),
    ...summary.navigation.chapterCards.map((card) => [card.id, card] as const)
  ]);
  const entries = new Map(
    index.chapters.map((entry) => [entry.chapterCardId, entry] as const)
  );
  const cardsByVolume = new Map<string, Map<string, ChapterCard>>();
  const indexedIds = new Set(index.plot.chapterCards.map(({ id }) => id));
  function append(card: ChapterCard) {
    const group =
      cardsByVolume.get(card.volumeId) ?? new Map<string, ChapterCard>();
    if (!group.has(card.id)) group.set(card.id, card);
    cardsByVolume.set(card.volumeId, group);
  }
  for (const card of summary.navigation.chapterCards) {
    if (indexedIds.has(card.id)) append(card);
  }
  for (const card of index.plot.chapterCards) append(card);
  const chaptersByVolume = new Map(
    [...cardsByVolume].map(([id, chapters]) => [id, [...chapters.values()]])
  );
  for (const chapters of chaptersByVolume.values()) {
    chapters.sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    );
  }
  let nextWritable: LongChapterCardId | null | undefined;
  return {
    volumes,
    cards,
    entries,
    chaptersByVolume,
    commits: new Map(index.ledger.commits.map((commit) => [commit.id, commit])),
    characterNames: new Map(
      summary.navigation.characters.map(({ id, name }) => [id, name])
    ),
    get nextWritable() {
      if (nextWritable === undefined)
        nextWritable = nextWritableLongChapterId(index);
      return nextWritable;
    }
  };
}

export type LongChapterLookup = ReturnType<typeof createLongChapterLookup>;

export function nextWritableLongChapterId(
  index: LongWorkspaceIndexSnapshot
): LongChapterCardId | null {
  const emptyIds = new Set(
    index.chapters
      .filter(({ bodyStatus }) => bodyStatus === "empty")
      .map(({ chapterCardId }) => chapterCardId)
  );
  if (!emptyIds.size) return null;
  const volumeOrder = new Map(
    index.plot.volumes.map(({ id, order }) => [id, order])
  );
  const ordered = index.plot.chapterCards
    .filter(({ id }) => emptyIds.has(id))
    .sort(
      (left, right) =>
        (volumeOrder.get(left.volumeId) ?? Number.MAX_SAFE_INTEGER) -
          (volumeOrder.get(right.volumeId) ?? Number.MAX_SAFE_INTEGER) ||
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    );
  return ordered[0]?.id ?? null;
}

export function indexedVolume(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  volumeId: LongVolumeId,
  lookup?: LongChapterLookup
) {
  if (lookup) return lookup.volumes.get(volumeId);
  return (
    summary.navigation.volumes.find(({ id }) => id === volumeId) ??
    workspaceIndex.plot.volumes?.find(({ id }) => id === volumeId)
  );
}

export function indexedChapterCard(
  summary: LongBookSummary,
  workspaceIndex: LongWorkspaceIndexSnapshot,
  chapterCardId: LongChapterCardId,
  lookup?: LongChapterLookup
) {
  if (lookup) return lookup.cards.get(chapterCardId);
  return (
    summary.navigation.chapterCards.find(({ id }) => id === chapterCardId) ??
    workspaceIndex.plot.chapterCards?.find(({ id }) => id === chapterCardId)
  );
}
