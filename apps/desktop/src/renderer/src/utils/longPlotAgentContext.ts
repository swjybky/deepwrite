import type {
  LongFileId,
  LongForeshadowingDirectorySnapshot,
  LongPlotFocusSnapshot,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceNavigationSnapshot
} from "@deepwrite/contracts";
import { LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES } from "@deepwrite/contracts/renderer";
import type {
  LongForeshadowingFocus,
  LongWorkspaceSelection
} from "../types/longWorkspace";

function buildForeshadowingDirectory(
  foreshadowing: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"],
  focusedThreadId?: string
): LongForeshadowingDirectorySnapshot {
  const toEntry = (
    thread: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"][number]
  ) => ({
    foreshadowingId: thread.id,
    title: thread.title,
    status: thread.status,
    ...(thread.plannedSpan ? { plannedSpan: thread.plannedSpan } : {}),
    beatCount: thread.beats.length
  });
  const visible = foreshadowing
    .slice(0, LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES)
    .map(toEntry);
  const focusedIndex = focusedThreadId
    ? foreshadowing.findIndex((thread) => thread.id === focusedThreadId)
    : -1;
  if (
    focusedIndex >= LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES &&
    visible.length === LONG_FORESHADOWING_DIRECTORY_MAX_ENTRIES
  ) {
    visible[visible.length - 1] = toEntry(foreshadowing[focusedIndex]!);
  }
  return {
    totalCount: foreshadowing.length,
    omittedCount: foreshadowing.length - visible.length,
    entries: visible
  };
}

/**
 * Captures where the user currently is inside the plot-design root. The
 * snapshot is derived from the already-loaded navigation index, so no
 * document reads are needed before sending a message.
 */
export function buildLongPlotFocusSnapshot(input: {
  selection: LongWorkspaceSelection | null;
  navigation: LongWorkspaceNavigationSnapshot;
  activeFileId?: LongFileId | null;
  foreshadowing?: LongWorkspaceIndexSnapshot["plot"]["foreshadowing"];
  foreshadowingFocus?: LongForeshadowingFocus;
}): LongPlotFocusSnapshot | undefined {
  const { selection, navigation } = input;
  if (
    selection?.root === "draft" &&
    selection.files.some(
      ({ role, file }) => role === "card" && file.id === input.activeFileId
    )
  ) {
    const chapterCard = navigation.chapterCards.find(
      ({ id }) => id === selection.chapterCardId
    );
    const volume = navigation.volumes.find(
      ({ id }) => id === chapterCard?.volumeId
    );
    if (!chapterCard || !volume) return undefined;
    return {
      section: "chapter_card",
      volumeId: volume.id,
      volumeTitle: volume.title,
      chapterCardId: chapterCard.id,
      chapterCardTitle: chapterCard.title
    };
  }
  if (selection?.root !== "plot_design") return undefined;
  if (selection.key === "plot-design:book-line") {
    return { section: "book_line" };
  }
  if (selection.key === "plot-design:foreshadowing") {
    const foreshadowing = input.foreshadowing ?? [];
    const focusedThread = input.foreshadowingFocus?.threadId
      ? foreshadowing.find(
          (thread) => thread.id === input.foreshadowingFocus?.threadId
        )
      : undefined;
    const focusedBeat =
      focusedThread && input.foreshadowingFocus?.beatId
        ? focusedThread.beats.find(
            (beat) => beat.id === input.foreshadowingFocus?.beatId
          )
        : undefined;
    return {
      section: "foreshadowing",
      foreshadowingDirectory: buildForeshadowingDirectory(
        foreshadowing,
        focusedThread?.id
      ),
      ...(focusedThread ? { foreshadowingThreadId: focusedThread.id } : {}),
      ...(focusedBeat ? { foreshadowingBeatId: focusedBeat.id } : {})
    };
  }
  if (selection.key.startsWith("plot-design:plot-points:")) {
    const volume = navigation.volumes.find(
      ({ id }) => id === selection.plotPointVolumeId
    );
    if (!volume) return undefined;
    const arc = navigation.arcs.find(({ id }) => id === selection.plotPointId);
    return {
      section: "plot_point",
      volumeId: volume.id,
      volumeTitle: volume.title,
      ...(arc ? { arcId: arc.id, arcTitle: arc.title } : {})
    };
  }
  return undefined;
}
