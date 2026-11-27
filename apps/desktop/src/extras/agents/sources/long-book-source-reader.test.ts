import {
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  truncate,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { splitDecompositionChunks } from "@deepwrite/contracts";
import { buildAnalysisSegments } from "../../../renderer/src/extras/long-book-analysis/batching";
import {
  mergeAnalysisChapter,
  renameAnalysisChapter,
  splitAnalysisChapter
} from "../../../renderer/src/extras/long-book-analysis/chapter-editing";
import {
  decodeLongBookAnalysisText,
  parseLongBookAnalysisTxt,
  readLongBookAnalysisSource
} from "./long-book-source-reader";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "deepwrite-analysis-source-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("long-book analysis source reader", () => {
  it("recognizes Chinese, English, special and numeric chapter headings", () => {
    const parsed = parseLongBookAnalysisTxt(
      [
        "序章",
        "雨落下来。",
        "第一卷 雾港",
        "第一章来信",
        "她打开信。",
        "Chapter 2 Return",
        "汽笛响起。",
        "3. 追踪",
        "脚步逼近。",
        "番外",
        "多年以后。"
      ].join("\n"),
      "novel.txt"
    );
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      "序章",
      "第一章 来信",
      "Chapter 2 Return",
      "3 追踪",
      "番外"
    ]);
    expect(parsed.chapters[1]?.volume).toBe("第一卷 雾港");
    expect(parsed.chapters[0]?.text).not.toContain("第一卷");
  });

  it("falls back to one chapter and reports a stable diagnostic", () => {
    const parsed = parseLongBookAnalysisTxt(
      "只有一段没有章号的正文。",
      "plain.txt"
    );
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.diagnostics[0]?.code).toBe("chapter_heading_not_found");
  });

  it("keeps publication timestamps inside chapter text", () => {
    const parsed = parseLongBookAnalysisTxt(
      [
        "第一章 起点",
        "第一段正文。",
        "2015-03-2313:00:01发表",
        "网页评论内容。",
        "第二章 继续",
        "第二段正文。"
      ].join("\n"),
      "scraped.txt"
    );

    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]?.text).toContain("2015-03-2313:00:01发表");
  });

  it("records rawHeading for stripped TXT heading lines while omitting it from non-stripped sources", async () => {
    const cleanSample = parseLongBookAnalysisTxt(
      [
        "第十四章 夜探古宅",
        "十四章前段甲：风吹过回廊，灯笼摇晃。",
        "十四章前段乙：桌案上摊开半页残纸。",
        "1. ABCD（原属第十四章中段的正文行）",
        "十四章后段甲：假章后续正文第一句，紧接在ABCD之后。",
        "第十五章 黎明破晓",
        "十五章正文：天光微亮。"
      ].join("\n"),
      "sample-15ch-clean.txt"
    );
    expect(cleanSample.chapters.map((item) => item.title)).toEqual([
      "第十四章 夜探古宅",
      "1 ABCD（原属第十四章中段的正文行）",
      "第十五章 黎明破晓"
    ]);
    expect(cleanSample.chapters[1]?.rawHeading).toBe(
      "1. ABCD（原属第十四章中段的正文行）"
    );

    const variants = parseLongBookAnalysisTxt(
      [
        "正文前引导段落。",
        "第十四章 夜探",
        "十四章前段。",
        "1. ABCD正文行",
        "后续一。",
        "第一节 ABCD正文行",
        "后续二。",
        "尾声 ABCD正文行",
        "后续三。",
        "chapter 1 ABCD正文行",
        "后续四。"
      ].join("\n"),
      "sample-heading-variants.txt"
    );
    expect(variants.chapters[0]?.title).toBe("正文前内容");
    expect(variants.chapters[0]?.rawHeading).toBeUndefined();
    expect(
      variants.chapters.slice(2).map((item) => ({
        title: item.title,
        rawHeading: item.rawHeading
      }))
    ).toEqual([
      { title: "1 ABCD正文行", rawHeading: "1. ABCD正文行" },
      { title: "第一节 ABCD正文行", rawHeading: "第一节 ABCD正文行" },
      { title: "尾声 ABCD正文行", rawHeading: "尾声 ABCD正文行" },
      { title: "chapter 1 ABCD正文行", rawHeading: "chapter 1 ABCD正文行" }
    ]);

    const fallback = parseLongBookAnalysisTxt(
      "只有一段没有章号的正文。",
      "plain.txt"
    );
    expect(fallback.chapters[0]?.rawHeading).toBeUndefined();

    const dir = await temporaryDirectory();
    await writeFile(join(dir, "01.txt"), "目录章节正文。", "utf8");
    const dirSource = await readLongBookAnalysisSource("directory", dir);
    expect(dirSource.chapters[0]?.rawHeading).toBeUndefined();
  });

  it("imports repeated headings without overflowing diagnostics", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "repeated-headings.txt");
    const lines = ["------------", "正文", "------------"];
    for (let index = 1; index <= 1_200; index += 1) {
      lines.push(
        `第${index}章 外层标题`,
        `\uFEFF    第${index}章 正文标题`,
        `这是第${index}章的正文内容。`
      );
    }
    await writeFile(path, lines.join("\n"), "utf8");

    const source = await readLongBookAnalysisSource("txt", path);

    expect(source.chapters).toHaveLength(1_200);
    expect(source.chapters[0]?.title).toBe("第1章 正文标题");
    expect(source.chapters[0]?.text).not.toContain("\uFEFF");
    expect(source.chapters.some((item) => item.title === "正文前内容")).toBe(
      false
    );
    expect(source.diagnostics).toEqual([
      expect.objectContaining({
        code: "empty_headings_skipped",
        message: expect.stringContaining("1,200")
      })
    ]);
  });

  it("decodes UTF-8 BOM and UTF-16 BOM", () => {
    expect(
      decodeLongBookAnalysisText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))
    ).toBe("A");
    expect(
      decodeLongBookAnalysisText(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))
    ).toBe("A");
    expect(
      decodeLongBookAnalysisText(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))
    ).toBe("A");
    expect(
      decodeLongBookAnalysisText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))
    ).toBe("中文");
  });

  it("naturally sorts nested chapter files and skips hidden files and symlinks", async () => {
    const root = await temporaryDirectory();
    const volume = join(root, "第一卷");
    await mkdir(volume);
    await writeFile(join(volume, "10.txt"), "第十章正文", "utf8");
    await writeFile(join(volume, "2.md"), "第二章正文", "utf8");
    await writeFile(join(root, ".hidden.txt"), "隐藏", "utf8");
    await symlink(join(volume, "2.md"), join(root, "linked.txt"));

    const source = await readLongBookAnalysisSource("directory", root);
    expect(source.chapters.map((chapter) => chapter.title)).toEqual([
      "2",
      "10"
    ]);
    expect(
      source.chapters.every((chapter) => chapter.volume === "第一卷")
    ).toBe(true);
    expect(
      source.diagnostics.some((item) => item.code === "symbolic_link_skipped")
    ).toBe(true);
  });

  it("rejects one source file above the 25 MiB safety limit", async () => {
    const root = await temporaryDirectory();
    const oversized = join(root, "oversized.txt");
    await writeFile(oversized, "", "utf8");
    await truncate(oversized, 25 * 1024 * 1024 + 1);
    await expect(readLongBookAnalysisSource("txt", oversized)).rejects.toThrow(
      /25 MiB/u
    );
  });

  it("recovers the misrecognized line from the imported sample-15ch-clean.txt across merge, split, and downstream chunking", async () => {
    const samplePath = resolve(
      process.cwd(),
      "test/2026-11-26-chapter-merge-loss/sample-15ch-clean.txt"
    );
    const raw = await readFile(samplePath, "utf8");
    const parsed = parseLongBookAnalysisTxt(raw, "sample-15ch-clean.txt");
    expect(parsed.chapters).toHaveLength(16);

    const ch14 = parsed.chapters[13]!;
    const ch15Fake = parsed.chapters[14]!;
    expect(ch15Fake.title).toBe("1 ABCD（原属第十四章中段的正文行）");
    expect(ch15Fake.rawHeading).toBe("1. ABCD（原属第十四章中段的正文行）");

    const mergedPrev = mergeAnalysisChapter(
      parsed.chapters,
      ch15Fake.id,
      "previous"
    );
    const mergedNext = mergeAnalysisChapter(parsed.chapters, ch14.id, "next");
    for (const merged of [mergedPrev, mergedNext]) {
      expect(merged).toHaveLength(15);
      expect(merged[13]?.text).toBe(
        [
          "十四章前段甲：风吹过回廊，灯笼摇晃。",
          "十四章前段乙：桌案上摊开半页残纸。",
          "1. ABCD（原属第十四章中段的正文行）",
          "十四章后段甲：假章后续正文第一句，紧接在ABCD之后。",
          "十四章后段乙：假章后续正文第二句，直至十四章末尾。"
        ].join("\n")
      );
      expect(merged[14]?.title).toBe("第十五章 黎明破晓");

      const segments = buildAnalysisSegments(merged, 4_000);
      expect(segments[13]?.text).toContain(
        "1. ABCD（原属第十四章中段的正文行）"
      );
      const chunks = splitDecompositionChunks(merged, {
        contextWindow: 128_000,
        maxTokens: 8192
      });
      expect(chunks.flatMap((chunk) => chunk.chapterIds)).toHaveLength(15);
    }

    // Manual split at cursor + rename + re-merge never inserts the manual title.
    const cursor = mergedPrev[13]!.text.indexOf("十四章后段甲");
    const split = splitAnalysisChapter(mergedPrev, ch14.id, cursor);
    const renamed = renameAnalysisChapter(split, split[14]!.id, "手填临时标题");
    const remerged = mergeAnalysisChapter(renamed, split[14]!.id, "previous");
    expect(remerged[13]?.text).toContain("1. ABCD（原属第十四章中段的正文行）");
    expect(remerged[13]?.text).not.toContain("手填临时标题");
    expect(remerged[13]?.text).not.toContain("（续）");
  });
});
