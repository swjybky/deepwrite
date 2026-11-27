import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LongBookAnalysisSource } from "@deepwrite/contracts";
import {
  LONG_BOOK_ANALYSIS_SOURCE_DIRECTORY,
  LongBookAnalysisSourceStore
} from "./long-book-source-store";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "deepwrite-analysis-store-"));
  temporaryDirectories.push(path);
  return path;
}

function source(id: string, text: string): LongBookAnalysisSource {
  return {
    id,
    kind: "txt",
    name: "重复导入的长篇.txt",
    chapters: [
      {
        id: `${id}_chapter`,
        order: 1,
        title: "第一章",
        sourceName: "重复导入的长篇.txt",
        text,
        charCount: text.length
      }
    ],
    diagnostics: []
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("LongBookAnalysisSourceStore", () => {
  it("keeps every import as an independent workspace snapshot", async () => {
    const workspace = await temporaryDirectory();
    const store = new LongBookAnalysisSourceStore(workspace);

    await store.save(
      source("long_book_analysis_source_11111111", "第一份正文")
    );
    await store.save(
      source("long_book_analysis_source_22222222", "第二份正文")
    );

    const catalog = await store.list();
    expect(catalog.sources).toHaveLength(2);
    expect(catalog.sources.map((item) => item.name)).toEqual([
      "重复导入的长篇.txt",
      "重复导入的长篇.txt"
    ]);
    expect(
      await store.load("long_book_analysis_source_11111111")
    ).toMatchObject(source("long_book_analysis_source_11111111", "第一份正文"));
    expect(
      await store.load("long_book_analysis_source_11111111")
    ).toMatchObject({
      revision: 1,
      fingerprint: expect.stringMatching(/^[a-f\d]{64}$/u)
    });
    expect(store.directory).toBe(
      join(workspace, LONG_BOOK_ANALYSIS_SOURCE_DIRECTORY)
    );
  });

  it("skips damaged metadata and rejects unsafe source ids", async () => {
    const workspace = await temporaryDirectory();
    const store = new LongBookAnalysisSourceStore(workspace);
    const damaged = join(
      workspace,
      LONG_BOOK_ANALYSIS_SOURCE_DIRECTORY,
      "damaged_source"
    );
    await mkdir(damaged, { recursive: true });
    await writeFile(join(damaged, "metadata.json"), "not-json", "utf8");

    await expect(store.list()).resolves.toEqual({ sources: [] });
    await expect(store.load("../../outside")).rejects.toThrow();
  });

  it("loads and saves legacy sources without rawHeading and persists merged rawHeading revisions", async () => {
    const workspace = await temporaryDirectory();
    const store = new LongBookAnalysisSourceStore(workspace);

    const legacy = source("long_book_analysis_source_legacy11", "旧版正文");
    await store.save(legacy);
    const loadedLegacy = await store.load(legacy.id);
    expect(loadedLegacy.chapters[0]?.rawHeading).toBeUndefined();

    const confirmedLegacy = await store.confirm({
      sourceId: loadedLegacy.id,
      sourceRevision: loadedLegacy.revision!,
      fingerprint: loadedLegacy.fingerprint!,
      range: { start: 1, end: 1 }
    });
    expect(confirmedLegacy.sourceRevision).toBe(1);

    const updatedLegacy = await store.saveChapters({
      sourceId: loadedLegacy.id,
      baseRevision: loadedLegacy.revision!,
      chapters: [{ ...loadedLegacy.chapters[0]!, text: "旧版合并正文" }]
    });
    expect(updatedLegacy.revision).toBe(2);

    const provenancedId = "long_book_analysis_source_prov2222";
    await store.save({
      id: provenancedId,
      kind: "txt",
      name: "sample-15ch-clean.txt",
      chapters: [
        {
          id: "ch14",
          order: 1,
          title: "第十四章 夜探古宅",
          rawHeading: "第十四章 夜探古宅",
          sourceName: "sample-15ch-clean.txt",
          text: "十四章前段甲。\n十四章前段乙。",
          charCount: 16
        },
        {
          id: "ch15_fake",
          order: 2,
          title: "1 ABCD（原属第十四章中段的正文行）",
          rawHeading: "1. ABCD（原属第十四章中段的正文行）",
          sourceName: "sample-15ch-clean.txt",
          text: "十四章后段甲。\n十四章后段乙。",
          charCount: 16
        },
        {
          id: "ch16",
          order: 3,
          title: "第十五章 黎明破晓",
          rawHeading: "第十五章 黎明破晓",
          sourceName: "sample-15ch-clean.txt",
          text: "十五章正文。",
          charCount: 6
        }
      ],
      diagnostics: []
    });

    const rev1 = await store.load(provenancedId);
    expect(rev1.chapters[1]?.rawHeading).toBe(
      "1. ABCD（原属第十四章中段的正文行）"
    );
    const mergedText = `${rev1.chapters[0]!.text}\n${rev1.chapters[1]!.rawHeading}\n${rev1.chapters[1]!.text}`;
    const rev2 = await store.saveChapters({
      sourceId: provenancedId,
      baseRevision: rev1.revision!,
      chapters: [
        {
          ...rev1.chapters[0]!,
          text: mergedText,
          charCount: mergedText.replace(/\s/gu, "").length
        },
        { ...rev1.chapters[2]!, order: 2 }
      ]
    });
    expect(rev2.revision).toBe(2);

    const reloaded = await store.load(provenancedId);
    expect(reloaded.revision).toBe(2);
    expect(reloaded.chapters).toHaveLength(2);
    expect(reloaded.chapters[0]?.text).toBe(mergedText);
    expect(reloaded.chapters[1]?.rawHeading).toBe("第十五章 黎明破晓");
    const persistedRev2 = await store.load(provenancedId, 2);
    expect(persistedRev2.chapters[0]?.text).toBe(mergedText);
  });
});
