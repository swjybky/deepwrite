import { describe, expect, it } from "vitest";
import type { LongBookAnalysisChapter } from "@deepwrite/contracts/renderer";
import { splitDecompositionChunks } from "@deepwrite/contracts/renderer";
import { buildAnalysisSegments } from "./batching";
import {
  mergeAnalysisChapter,
  moveAnalysisChapter,
  renameAnalysisChapter,
  resolveMergedChapterTargetId,
  shouldHandleChapterCorrectionUndoKeydown,
  splitAnalysisChapter
} from "./chapter-editing";

function chapters(): LongBookAnalysisChapter[] {
  return [
    {
      id: "chapter-1",
      order: 1,
      title: "第一章",
      rawHeading: "第一章",
      sourceName: "1.txt",
      text: "前半段。\n后半段。",
      charCount: 8
    },
    {
      id: "chapter-2",
      order: 2,
      title: "第二章",
      rawHeading: "第二章",
      sourceName: "2.txt",
      text: "第二章正文。",
      charCount: 6
    }
  ];
}

function misrecognizedSampleChapters(): LongBookAnalysisChapter[] {
  return [
    {
      id: "ch14",
      order: 1,
      title: "第十四章 夜探古宅",
      rawHeading: "第十四章 夜探古宅",
      sourceName: "sample-15ch-clean.txt",
      text: "十四章前段甲：风吹过回廊，灯笼摇晃。\n十四章前段乙：桌案上摊开半页残纸。",
      charCount: 36
    },
    {
      id: "ch15-fake",
      order: 2,
      title: "1 ABCD（原属第十四章中段的正文行）",
      rawHeading: "1. ABCD（原属第十四章中段的正文行）",
      sourceName: "sample-15ch-clean.txt",
      text: "十四章后段甲：假章后续正文第一句，紧接在ABCD之后。\n十四章后段乙：假章后续正文第二句，直至十四章末尾。",
      charCount: 53
    },
    {
      id: "ch16",
      order: 3,
      title: "第十五章 黎明破晓",
      rawHeading: "第十五章 黎明破晓",
      sourceName: "sample-15ch-clean.txt",
      text: "十五章正文：天光微亮，众人推门离开古宅。",
      charCount: 20
    }
  ];
}

describe("long-book analysis chapter correction", () => {
  it("renames and reorders with contiguous chapter numbers", () => {
    const renamed = renameAnalysisChapter(chapters(), "chapter-1", "新的开篇");
    const moved = moveAnalysisChapter(renamed, "chapter-2", 0);
    expect(moved.map(({ order, title }) => ({ order, title }))).toEqual([
      { order: 1, title: "第二章" },
      { order: 2, title: "新的开篇" }
    ]);
  });

  it("restores the stripped rawHeading in both merge directions and preserves punctuation, breaks, and analysis chunks", () => {
    const expectedMergedText = [
      "十四章前段甲：风吹过回廊，灯笼摇晃。",
      "十四章前段乙：桌案上摊开半页残纸。",
      "1. ABCD（原属第十四章中段的正文行）",
      "十四章后段甲：假章后续正文第一句，紧接在ABCD之后。",
      "十四章后段乙：假章后续正文第二句，直至十四章末尾。"
    ].join("\n");

    const sample = misrecognizedSampleChapters();
    expect(resolveMergedChapterTargetId(sample, "ch15-fake", "previous")).toBe(
      "ch14"
    );
    expect(resolveMergedChapterTargetId(sample, "ch14", "next")).toBe("ch14");

    const mergedIntoPrevious = mergeAnalysisChapter(
      sample,
      "ch15-fake",
      "previous"
    );
    const mergedWithNext = mergeAnalysisChapter(sample, "ch14", "next");

    for (const merged of [mergedIntoPrevious, mergedWithNext]) {
      expect(merged).toHaveLength(2);
      expect(merged[0]?.title).toBe("第十四章 夜探古宅");
      expect(merged[0]?.rawHeading).toBe("第十四章 夜探古宅");
      expect(merged[0]?.text).toBe(expectedMergedText);
      expect(merged[1]?.title).toBe("第十五章 黎明破晓");
      expect(merged[1]?.text).toBe("十五章正文：天光微亮，众人推门离开古宅。");

      const segments = buildAnalysisSegments(merged, 4_000);
      expect(segments[0]?.text).toContain(
        "1. ABCD（原属第十四章中段的正文行）"
      );
      const chunks = splitDecompositionChunks(merged, {
        contextWindow: 128_000,
        maxTokens: 8192
      });
      expect(chunks[0]?.chapterIds).toEqual(["ch14", "ch16"]);
    }
  });

  it("restores consecutive misrecognized headings in original order regardless of merge order", () => {
    const consecutive: LongBookAnalysisChapter[] = [
      {
        id: "c1",
        order: 1,
        title: "第十四章",
        rawHeading: "第十四章",
        sourceName: "sample.txt",
        text: "段落一。",
        charCount: 4
      },
      {
        id: "c2",
        order: 2,
        title: "1 第一条误判",
        rawHeading: "1. 第一条误判",
        sourceName: "sample.txt",
        text: "段落二。",
        charCount: 4
      },
      {
        id: "c3",
        order: 3,
        title: "2 第二条误判",
        rawHeading: "2. 第二条误判",
        sourceName: "sample.txt",
        text: "段落三。",
        charCount: 4
      }
    ];
    const topDown = mergeAnalysisChapter(
      mergeAnalysisChapter(consecutive, "c1", "next"),
      "c1",
      "next"
    );
    const bottomUp = mergeAnalysisChapter(
      mergeAnalysisChapter(consecutive, "c3", "previous"),
      "c2",
      "previous"
    );
    const expected =
      "段落一。\n1. 第一条误判\n段落二。\n2. 第二条误判\n段落三。";
    expect(topDown[0]?.text).toBe(expected);
    expect(bottomUp[0]?.text).toBe(expected);
  });

  it("splits at the cursor and merges without inserting manual titles into body text", () => {
    const original = chapters();
    const cursor = original[0]!.text.indexOf("后半段");
    const split = splitAnalysisChapter(original, "chapter-1", cursor);
    expect(split).toHaveLength(3);
    expect(split[0]?.rawHeading).toBe("第一章");
    expect(split[1]?.rawHeading).toBeUndefined();

    const renamedSplit = renameAnalysisChapter(
      split,
      split[1]!.id,
      "手填临时小节标题"
    );
    const merged = mergeAnalysisChapter(
      renamedSplit,
      renamedSplit[1]!.id,
      "previous"
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]!.text).toBe("前半段。\n\n后半段。");
    expect(merged[0]!.text).not.toContain("（续）");
    expect(merged[0]!.text).not.toContain("手填临时小节标题");
    expect(merged.map((chapter) => chapter.order)).toEqual([1, 2]);
  });

  it("safely degrades when merging legacy chapters without rawHeading", () => {
    const legacy: LongBookAnalysisChapter[] = [
      {
        id: "legacy-1",
        order: 1,
        title: "第十四章",
        sourceName: "legacy.txt",
        text: "前段。",
        charCount: 3
      },
      {
        id: "legacy-2",
        order: 2,
        title: "旧记录假章标题",
        sourceName: "legacy.txt",
        text: "后段。",
        charCount: 3
      }
    ];
    const merged = mergeAnalysisChapter(legacy, "legacy-2", "previous");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text).toBe("前段。\n\n后段。");
    expect(merged[0]?.text).not.toContain("旧记录假章标题");
  });

  it("handles scoped Ctrl/Cmd+Z only outside editable inputs", () => {
    const base = {
      key: "z",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      isComposing: false
    };
    expect(
      shouldHandleChapterCorrectionUndoKeydown(
        { ...base, target: { tagName: "BUTTON" } },
        true
      )
    ).toBe(true);
    expect(
      shouldHandleChapterCorrectionUndoKeydown(
        {
          ...base,
          metaKey: false,
          ctrlKey: true,
          target: { tagName: "TEXTAREA", readOnly: true }
        },
        true
      )
    ).toBe(true);
    expect(
      shouldHandleChapterCorrectionUndoKeydown(
        { ...base, target: { tagName: "INPUT" } },
        true
      )
    ).toBe(false);
    expect(
      shouldHandleChapterCorrectionUndoKeydown(
        { ...base, target: { tagName: "TEXTAREA", readOnly: false } },
        true
      )
    ).toBe(false);
    expect(
      shouldHandleChapterCorrectionUndoKeydown(
        { ...base, target: { tagName: "DIV", isContentEditable: true } },
        true
      )
    ).toBe(false);
    expect(
      shouldHandleChapterCorrectionUndoKeydown(
        { ...base, shiftKey: true, target: { tagName: "SECTION" } },
        true
      )
    ).toBe(false);
    expect(
      shouldHandleChapterCorrectionUndoKeydown(
        { ...base, target: { tagName: "SECTION" } },
        false
      )
    ).toBe(false);
  });
});
