import { createScopedTranslator } from "../../i18n";
import {
  LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS,
  LongBookAnalysisChapterSchema,
  type LongBookAnalysisChapter
} from "@deepwrite/contracts/renderer";
import { createId } from "@deepwrite/shared";

const t = createScopedTranslator("extras.longBookAnalysis");

function normalize(
  chapters: readonly LongBookAnalysisChapter[]
): LongBookAnalysisChapter[] {
  return chapters.map((chapter, index) =>
    LongBookAnalysisChapterSchema.parse({
      ...chapter,
      order: index + 1,
      charCount: chapter.text.replace(/\s/gu, "").length || chapter.text.length
    })
  );
}

export function renameAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  title: string
): LongBookAnalysisChapter[] {
  const nextTitle = title.trim();
  if (!nextTitle) throw new Error(t("chapterTitleRequired"));
  return normalize(
    chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, title: nextTitle } : chapter
    )
  );
}

export function moveAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  targetIndex: number
): LongBookAnalysisChapter[] {
  const fromIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (fromIndex < 0) throw new Error(t("moveChapterMissing"));
  const boundedTarget = Math.max(0, Math.min(chapters.length - 1, targetIndex));
  const next = chapters.slice();
  const [chapter] = next.splice(fromIndex, 1);
  if (!chapter) throw new Error(t("moveChapterMissing"));
  next.splice(boundedTarget, 0, chapter);
  return normalize(next);
}

export function deleteAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string
): LongBookAnalysisChapter[] {
  if (!chapters.some((chapter) => chapter.id === chapterId))
    throw new Error(t("deleteChapterMissing"));
  if (chapters.length <= 1) throw new Error(t("keepOneChapter"));
  return normalize(chapters.filter((chapter) => chapter.id !== chapterId));
}

export function splitAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  cursor: number,
  secondTitle?: string
): LongBookAnalysisChapter[] {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  const chapter = chapters[index];
  if (!chapter) throw new Error(t("splitChapterMissing"));
  const left = chapter.text.slice(0, cursor).trim();
  const right = chapter.text.slice(cursor).trim();
  if (!left || !right) throw new Error(t("splitCursorRequired"));
  const { rawHeading: _rawHeading, ...chapterWithoutHeading } = chapter;
  const next = chapters.slice();
  next.splice(
    index,
    1,
    { ...chapter, text: left, charCount: left.replace(/\s/gu, "").length },
    {
      ...chapterWithoutHeading,
      id: createId("analysis_chapter"),
      title:
        secondTitle?.trim() ||
        t("chapterContinuation", {
          title: chapter.title
        }),
      text: right,
      charCount: right.replace(/\s/gu, "").length
    }
  );
  return normalize(next);
}

export function resolveMergedChapterTargetId(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  direction: "previous" | "next"
): string | undefined {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (index < 0) return undefined;
  const adjacentIndex = direction === "previous" ? index - 1 : index + 1;
  if (adjacentIndex < 0 || adjacentIndex >= chapters.length) return undefined;
  return chapters[Math.min(index, adjacentIndex)]?.id;
}

export function mergeAnalysisChapter(
  chapters: readonly LongBookAnalysisChapter[],
  chapterId: string,
  direction: "previous" | "next"
): LongBookAnalysisChapter[] {
  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  const adjacentIndex = direction === "previous" ? index - 1 : index + 1;
  const chapter = chapters[index];
  const adjacent = chapters[adjacentIndex];
  if (!chapter || !adjacent) throw new Error(t("noAdjacentChapter"));
  const first = direction === "previous" ? adjacent : chapter;
  const second = direction === "previous" ? chapter : adjacent;
  const recoveredHeading = second.rawHeading?.trimEnd();
  const text = recoveredHeading?.trim()
    ? `${first.text.trim()}\n${recoveredHeading}\n${second.text.trim()}`
    : `${first.text.trim()}\n\n${second.text.trim()}`;
  if (text.length > LONG_BOOK_ANALYSIS_MAX_CHAPTER_CHARACTERS) {
    throw new Error(t("mergedChapterTooLong"));
  }
  const next = chapters.slice();
  next.splice(Math.min(index, adjacentIndex), 2, {
    ...first,
    text,
    charCount: text.replace(/\s/gu, "").length
  });
  return normalize(next);
}

export interface UndoKeydownLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  target?: unknown;
}

export function isEditableUndoTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as {
    tagName?: unknown;
    readOnly?: unknown;
    isContentEditable?: unknown;
  };
  if (element.isContentEditable === true) return true;
  const tag =
    typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "SELECT") return true;
  if (tag === "TEXTAREA") return element.readOnly !== true;
  return false;
}

export function shouldHandleChapterCorrectionUndoKeydown(
  event: UndoKeydownLike,
  canUndo: boolean
): boolean {
  if (!canUndo || event.defaultPrevented || event.isComposing) return false;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.key.toLowerCase() !== "z") return false;
  return !isEditableUndoTarget(event.target);
}
