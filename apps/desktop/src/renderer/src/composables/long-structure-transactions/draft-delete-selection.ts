import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import {
  createLongChapterSelection,
  type LongWorkspaceSelection
} from "../../types/longWorkspace";
import { longNavigationNodeId } from "../../utils/longWorkspaceResourceTree";
import type { LongDraftSectionDeleteTarget } from "../../stores/longWorkspaceStore";

export function selectAfterLongDraftSectionDelete(input: {
  pending: LongDraftSectionDeleteTarget;
  summary: LongBookSummary | null;
  index: LongWorkspaceIndexSnapshot | null;
  selectedChapterCardId: string | undefined;
  selectedResourceId: Ref<string>;
  selectWorkspaceFile(selection: LongWorkspaceSelection): Promise<unknown>;
  runTracked<T>(task: () => Promise<T>): Promise<T>;
  isDisposed(): boolean;
  reportError(message: string): void;
}): void {
  const { pending, summary, index } = input;
  const deletedSelected =
    input.selectedChapterCardId === pending.chapterCardId ||
    input.selectedResourceId.value ===
      longNavigationNodeId(pending.bookId, `chapter:${pending.chapterCardId}`);
  if (!deletedSelected || !summary || !index || summary.id !== pending.bookId) {
    return;
  }
  const next = summary.navigation.chapterCards
    .filter((chapter) => chapter.volumeId === pending.volumeId)
    .sort(
      (left, right) =>
        left.narrativeOrder - right.narrativeOrder ||
        left.id.localeCompare(right.id)
    )[0];
  if (next) {
    const selection = createLongChapterSelection(summary, index, next.id);
    if (selection) {
      input.selectedResourceId.value = longNavigationNodeId(
        pending.bookId,
        selection.key
      );
      void input
        .runTracked(() => input.selectWorkspaceFile(selection))
        .catch((error: unknown) => {
          if (input.isDisposed()) return;
          input.reportError(
            error instanceof Error
              ? error.message
              : "小节已删除，但无法打开下一小节。"
          );
        });
      return;
    }
  }
  input.selectedResourceId.value = longNavigationNodeId(
    pending.bookId,
    `volume:${pending.volumeId}`
  );
}
