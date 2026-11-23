import type {
  CatalogSnapshot,
  LongBookAnalysisPreset,
  ModelConfig
} from "@deepwrite/contracts/renderer";
import { describe, expect, it } from "vitest";
import {
  analysisOutputTypeLabel,
  analysisThinkingOptions,
  compatibleAnalysisLibraries
} from "./task-options";

const plotPreset = {
  id: "plot-structure",
  name: "剧情结构",
  description: "拆解剧情结构。",
  systemPrompt: "依据章节证据提炼剧情结构。",
  output: {
    domain: "material",
    kind: "plot",
    stageId: "pacing"
  }
} as const satisfies LongBookAnalysisPreset;

const snapshot = {
  materials: [
    { id: "plot-library", title: "剧情库", materialKind: "plot" },
    { id: "mixed-library", title: "综合库", materialKind: "mixed" },
    { id: "character-library", title: "人物库", materialKind: "character" }
  ],
  skills: []
} as unknown as CatalogSnapshot;

describe("long-book analysis task options", () => {
  it("offers the preset's compatible concrete material libraries", () => {
    expect(
      compatibleAnalysisLibraries(plotPreset, snapshot).map(
        (library) => library.id
      )
    ).toEqual(["plot-library", "mixed-library"]);
    expect(analysisOutputTypeLabel(plotPreset)).toBe("剧情设计");
  });

  it.each([true, false])(
    "offers the configured options when reasoning is %s",
    (reasoning) => {
      const model = {
        reasoning,
        thinkingLevelOptions: ["low", "high", "custom-effort"]
      } as ModelConfig;
      expect(analysisThinkingOptions(model)).toEqual([
        { value: "off", label: "关闭" },
        { value: "low", label: "较低" },
        { value: "high", label: "深度" },
        { value: "custom-effort", label: "custom-effort" }
      ]);
    }
  );
});
