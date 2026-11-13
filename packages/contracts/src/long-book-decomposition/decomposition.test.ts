import { describe, expect, it } from "vitest";
import {
  splitDecompositionChunks,
  decompositionInputBudget,
  decompositionReadingUnitId
} from "./chunking";
import { DECOMPOSITION_MAX_CHARACTERS } from "./limits";
import { DEFAULT_DECOMPOSITION_PROFILE } from "./profile";
import {
  LongBookDecompositionJobSchema,
  DecompositionSourceRefSchema
} from "./job";
import { LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS } from "../long-book-analysis-limits";
import {
  DecompositionRecordFileSchema,
  decompositionAssetProse
} from "./records";
import { DecompositionReadingCardSchema } from "./cards";
import { CreateDecompositionJobInputSchema } from "./commands";
import { DecompositionReceiptSchema } from "./target";
import { estimateDecomposition } from "./estimate";
import type { LongBookAnalysisChapter } from "../long-book-analysis-sources";
const model = { contextWindow: 128_000, maxTokens: 8192 };
const chapter = (
  order: number,
  text = "合成正文",
  volume = "卷一"
): LongBookAnalysisChapter => ({
  id: `chapter_${order}`,
  order,
  title: `第 ${order} 章`,
  volume,
  sourceName: "合成样书.txt",
  text,
  charCount: text.length
});

describe("整书拆解纯契约", () => {
  it("拆解来源上限与长篇来源导入上限一致", () => {
    expect(DECOMPOSITION_MAX_CHARACTERS).toBe(
      LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS
    );
    const now = new Date().toISOString();
    const result = LongBookDecompositionJobSchema.safeParse({
      schemaVersion: 1,
      id: "ldjob_large_source",
      createdAt: now,
      updatedAt: now,
      mode: "continuation",
      outputVersion: 1,
      targetSelection: { action: "create", kind: "long", title: "大书" },
      source: {
        sourceId: "source_large",
        sourceRevision: 1,
        title: "大书",
        fingerprint: "a".repeat(64),
        confirmationId: "confirm_large",
        confirmedAt: now,
        chapterCount: 301,
        characterCount: LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS - 1,
        range: { start: 1, end: 301 }
      },
      profile: DEFAULT_DECOMPOSITION_PROFILE,
      models: {
        reading: {
          modelId: "faux",
          thinkingLevel: "off",
          contextWindow: 128_000
        },
        integration: {
          modelId: "faux",
          thinkingLevel: "off",
          contextWindow: 128_000
        }
      },
      chunks: [
        {
          id: "chunk:1",
          startOrder: 1,
          endOrder: 301,
          chapterIds: ["chapter_1"],
          estimatedTokens: 1
        }
      ],
      phase: "prepare_target",
      status: "idle",
      autoContinue: false,
      units: {}
    });
    expect(result.success).toBe(true);
  });

  it("20 章上限、不跨卷、完整保留顺序", () => {
    const chapters = Array.from({ length: 65 }, (_, i) =>
      chapter(i + 1, "正文", i < 25 ? "卷一" : "卷二")
    );
    const chunks = splitDecompositionChunks(chapters, model);
    expect(chunks.map(({ chapterIds }) => chapterIds.length)).toEqual([
      20, 5, 20, 20
    ]);
    expect(chunks.flatMap(({ chapterIds }) => chapterIds)).toEqual(
      chapters.map(({ id }) => id)
    );
    expect(
      chunks.every(({ estimatedTokens }) => estimatedTokens <= 60_000)
    ).toBe(true);
  });
  it("超长章按段落分片，Unicode 与原文无损，检查点保持章节身份", () => {
    const text = "千字段落😀。\n".repeat(5000);
    const chunks = splitDecompositionChunks([chapter(1, text)], {
      contextWindow: 16_000,
      maxTokens: 4096
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks
        .map(({ segment }) => text.slice(segment!.start, segment!.end))
        .join("")
    ).toBe(text);
    expect(
      chunks.every(
        ({ segment }) =>
          segment?.chapterId === "chapter_1" && segment.count === chunks.length
      )
    ).toBe(true);
    expect(
      new Set(
        chunks.map((chunk) => decompositionReadingUnitId(chunk, "chapter_1"))
      ).size
    ).toBe(chunks.length);
  });
  it.each([
    { contextWindow: 128_000, maxTokens: 8192 },
    { contextWindow: 16_000, maxTokens: 4096 }
  ])("边界换行不会超出模型分片预算（窗口 $contextWindow）", (capacity) => {
    const budget = decompositionInputBudget(capacity, 100);
    const maxCharacters = Math.floor(budget / 1.5);
    const text =
      "文".repeat(maxCharacters) +
      "\n" +
      "文".repeat(maxCharacters - 1) +
      "\n尾文😀";
    const chunks = splitDecompositionChunks([chapter(1, text)], capacity, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every(({ estimatedTokens }) => estimatedTokens <= budget)
    ).toBe(true);
    expect(
      chunks
        .map(({ segment }) => text.slice(segment!.start, segment!.end))
        .join("")
    ).toBe(text);
    expect(chunks[0]!.segment!.start).toBe(0);
    expect(chunks.at(-1)!.segment!.end).toBe(text.length);
    chunks.forEach(({ segment }, index) => {
      expect(segment!.index).toBe(index);
      expect(segment!.count).toBe(chunks.length);
      expect(segment!.chapterId).toBe("chapter_1");
      if (index > 0)
        expect(segment!.start).toBe(chunks[index - 1]!.segment!.end);
    });
  });
  it("未知/过小窗口与过长方案不会假定模型能容纳", () => {
    expect(() => decompositionInputBudget({})).toThrow();
    expect(() => decompositionInputBudget({ contextWindow: 15_999 })).toThrow();
    expect(() =>
      decompositionInputBudget({ contextWindow: 16_000 }, 20_000)
    ).toThrow();
  });
  it("任务记录文件往返保留结构，损坏记录被拒", () => {
    const record = {
      unitId: "style:profile",
      data: {
        kind: "asset" as const,
        asset: {
          kind: "style" as const,
          content: "## 句式\n\n短句推进。",
          excerpts: [{ chapterOrder: 1, text: "合成正文", comment: "短句。" }]
        }
      }
    };
    const file = {
      schemaVersion: 1 as const,
      jobId: "ldjob_1",
      outputVersion: 1,
      inputRevision: "v1",
      savedAt: new Date().toISOString(),
      record
    };
    expect(
      DecompositionRecordFileSchema.parse(JSON.parse(JSON.stringify(file)))
    ).toEqual(file);
    expect(
      DecompositionRecordFileSchema.safeParse({
        ...file,
        record: { ...record, data: { kind: "invalid" } }
      }).success
    ).toBe(false);
    expect(
      DecompositionRecordFileSchema.safeParse({ ...file, extra: true }).success
    ).toBe(false);
    const prose = decompositionAssetProse(record.data.asset);
    expect(prose).toContain("典型片段");
    expect(prose).not.toContain("deepwrite-decomposition");
  });
  it("来源事实只能挂到当前提交的章节，空梗概不可提交", () => {
    const card = {
      chunkId: "chunk:1",
      chapters: [
        {
          chapterId: "chapter_1",
          order: 1,
          title: "一",
          summary: "梗概",
          events: [],
          characters: []
        }
      ],
      characters: [],
      world: [],
      plot: {
        events: [{ text: "越界事实", chapterOrder: 2 }],
        foreshadowing: []
      },
      style: { notes: [], excerpts: [] }
    };
    expect(DecompositionReadingCardSchema.safeParse(card).success).toBe(false);
    expect(
      DecompositionReadingCardSchema.safeParse({
        ...card,
        plot: { events: [], foreshadowing: [] },
        chapters: [{ ...card.chapters[0], summary: "" }]
      }).success
    ).toBe(false);
  });
  it("目标选择与模式绑定，只有任务记录的单元回执可无目标引用", () => {
    expect(
      CreateDecompositionJobInputSchema.safeParse({
        mode: "materials",
        targetSelection: { kind: "long", action: "create", title: "错误" }
      }).success
    ).toBe(false);
    expect(
      DecompositionReceiptSchema.safeParse({
        id: "receipt_1",
        jobId: "job_1",
        outputVersion: 1,
        unitId: "unit_1",
        inputRevision: "v1",
        savedAt: new Date().toISOString(),
        refs: []
      }).success
    ).toBe(true);
  });
  it("并发智能体数默认 5，只接受 1 到 10，预估耗时随并发缩短", () => {
    const input = {
      confirmation: {
        id: "confirm_1",
        sourceId: "source_1",
        sourceRevision: 1,
        fingerprint: "a".repeat(64),
        range: { start: 1, end: 1 },
        confirmedAt: "2026-11-12T00:00:00.000Z"
      },
      profileId: "default",
      mode: "continuation",
      targetSelection: { kind: "long", action: "create", title: "目标" },
      models: {
        reading: { modelId: "model_1", thinkingLevel: "off" },
        integration: { modelId: "model_1", thinkingLevel: "off" }
      }
    };
    const parsed = CreateDecompositionJobInputSchema.safeParse(input);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.maxConcurrency).toBe(5);
    for (const maxConcurrency of [0, 11, 2.5])
      expect(
        CreateDecompositionJobInputSchema.safeParse({
          ...input,
          maxConcurrency
        }).success
      ).toBe(false);
    expect(
      CreateDecompositionJobInputSchema.parse({ ...input, maxConcurrency: 10 })
        .maxConcurrency
    ).toBe(10);
    const serial = estimateDecomposition(300, 300_000, 15, 1);
    const wide = estimateDecomposition(300, 300_000, 15, 10);
    expect(serial.calls).toBe(wide.calls);
    expect(serial.minutes[1]).toBeGreaterThan(wide.minutes[1]);
  });
  it("300 万字预估始终以区间表达成本与时间", () => {
    const estimate = estimateDecomposition(3000, 3_000_000, 150);
    expect(estimate.inputTokens[1]).toBeGreaterThan(estimate.inputTokens[0]);
    expect(estimate.outputTokens[1]).toBeGreaterThan(estimate.outputTokens[0]);
    expect(estimate.minutes[1]).toBeGreaterThan(estimate.minutes[0]);
  });
});

it("合并主分支后同时保留五万章和五千万字符上限", () => {
  const source = {
    sourceId: "source_large",
    sourceRevision: 1,
    title: "合成大书",
    fingerprint: "a".repeat(64),
    confirmationId: "confirm_large",
    confirmedAt: "2026-10-18T00:00:00.000Z",
    chapterCount: 50_000,
    characterCount: LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS,
    range: { start: 1, end: 50_000 }
  };
  expect(DecompositionSourceRefSchema.safeParse(source).success).toBe(true);
  expect(
    DecompositionSourceRefSchema.safeParse({ ...source, chapterCount: 50_001 })
      .success
  ).toBe(false);
  expect(
    DecompositionSourceRefSchema.safeParse({
      ...source,
      characterCount: LONG_BOOK_ANALYSIS_MAX_TOTAL_CHARACTERS + 1
    }).success
  ).toBe(false);
});
