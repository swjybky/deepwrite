import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  LongBookAnalysisSavedSourceCatalogSchema,
  ExtrasAgentSettingsInputSchema,
  LongBookAnalysisRuntimeContextSchema
} from "./index";
import { LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS } from "./long-book-analysis-limits";

const segment = {
  id: "segment-1",
  chapterId: "chapter-1",
  chapterOrder: 1,
  chapterTitle: "第一章",
  segmentIndex: 1,
  segmentCount: 1,
  text: "门在雨夜里打开。"
};

function runtime(selectionEnd = 1) {
  return {
    phase: "batch" as const,
    jobId: "job-1",
    unitId: "unit-1",
    sourceTitle: "测试长篇.txt",
    selectionStart: 1,
    selectionEnd,
    segments: [segment]
  };
}

const profile = {
  id: "plot-structure",
  name: "剧情结构",
  description: "拆解剧情结构。",
  systemPrompt: "依据章节证据提炼剧情结构。",
  output: {
    domain: "material" as const,
    kind: "plot" as const,
    stageId: "pacing" as const
  }
};

describe("long-book analysis contracts", () => {
  it("validates saved source catalogs and source commands", () => {
    expect(
      LongBookAnalysisSavedSourceCatalogSchema.parse({
        sources: [
          {
            id: "long_book_analysis_source_1234abcd",
            kind: "txt",
            name: "测试长篇.txt",
            chapterCount: 12,
            characterCount: 24_000,
            importedAt: "2026-08-30T01:02:03.000Z"
          }
        ]
      }).sources
    ).toHaveLength(1);
    expect(
      CommandEnvelopeSchema.safeParse({
        ...createEnvelope(
          "longBookAnalysis.listSources",
          {},
          {
            id: "cmd-list-sources"
          }
        )
      }).success
    ).toBe(true);
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "longBookAnalysis.loadSource",
          { sourceId: "../../unsafe" },
          { id: "cmd-load-source" }
        )
      ).success
    ).toBe(false);
  });

  it("accepts dynamic output mappings and rejects duplicate preset names", () => {
    const settings = (profiles: unknown[]) =>
      ExtrasAgentSettingsInputSchema.parse({
        agentId: "long-book-analysis",
        profiles
      });
    expect(settings([profile]).profiles[0]).toMatchObject({
      output: profile.output
    });
    expect(() =>
      settings([profile, { ...profile, id: "another", name: "剧情结构 " }])
    ).toThrow("预设名称和标识不能重复。");
  });

  it("validates source deletion commands and rejects unsafe source ids", () => {
    const sourceId = "long_book_analysis_source_1234abcd";
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "longBookAnalysis.deleteSource",
          { sourceId },
          { id: "cmd-delete-source" }
        )
      ).payload
    ).toEqual({ sourceId });
    expect(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "longBookAnalysis.coreSource",
          {
            workspaceDirectory: "/tmp/deepwrite-test-workspace",
            operation: "delete",
            sourceId
          },
          { id: "cmd-delete-stored-source" }
        )
      ).payload
    ).toMatchObject({ operation: "delete", sourceId });
    expect(
      CommandEnvelopeSchema.safeParse(
        createEnvelope(
          "longBookAnalysis.deleteSource",
          { sourceId: "../../unsafe" },
          { id: "cmd-delete-source" }
        )
      ).success
    ).toBe(false);
  });

  it.each(["long-book-analysis", "short-book-analysis"])(
    "ignores legacy default libraries while keeping %s profiles usable",
    (agentId) => {
      const parsed = ExtrasAgentSettingsInputSchema.parse({
        agentId,
        profiles: [
          {
            ...profile,
            ...(agentId === "short-book-analysis"
              ? { selectionMode: "single" }
              : {}),
            output: { ...profile.output, libraryId: "legacy-library" }
          }
        ]
      });
      expect(parsed.profiles[0]).toMatchObject({
        id: profile.id,
        systemPrompt: profile.systemPrompt,
        output: profile.output
      });
      expect(parsed.profiles[0]).not.toHaveProperty("output.libraryId");
    }
  );

  it("allows exactly 50 continuous chapters and rejects 51", () => {
    expect(
      LongBookAnalysisRuntimeContextSchema.parse(runtime(50)).selectionEnd
    ).toBe(50);
    expect(() =>
      LongBookAnalysisRuntimeContextSchema.parse(runtime(51))
    ).toThrow(/50/iu);
  });

  it("supports segmented sources larger than ten thousand chapters", () => {
    expect(LONG_BOOK_ANALYSIS_MAX_SOURCE_CHAPTERS).toBe(50_000);
  });
});
