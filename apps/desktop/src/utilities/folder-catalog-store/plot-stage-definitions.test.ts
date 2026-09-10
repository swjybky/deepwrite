import { describe, expect, it } from "vitest";
import { mergeCreativePlotStageDefinitions } from "./plot-stage-definitions";

describe("imported plot stage definitions", () => {
  it("creates missing definitions and preserves different IDs with duplicate titles", () => {
    const incoming = [
      { id: "custom-a", title: "剧情灵感设计", description: "作品 A 的阶段" },
      { id: "custom-b", title: "剧情灵感设计", description: "作品 B 的阶段" },
      {
        id: "custom-c",
        title: "剧情灵感设计（2）",
        description: "原有带序号名称"
      }
    ];
    const merged = mergeCreativePlotStageDefinitions(incoming);
    expect(merged.filter(({ id }) => id.startsWith("custom-"))).toEqual([
      incoming[0],
      { ...incoming[1], title: "剧情灵感设计（3）" },
      incoming[2]
    ]);
    expect(incoming[1]?.title).toBe("剧情灵感设计");
    expect(merged.some(({ id }) => id === "outline")).toBe(true);
    expect(mergeCreativePlotStageDefinitions(merged, incoming)).toEqual(merged);
  });

  it("deduplicates identical IDs and handles case-insensitive title collisions within the title limit", () => {
    const title = "A".repeat(120);
    const merged = mergeCreativePlotStageDefinitions([
      { id: "first", title, description: "原始定义" },
      { id: "second", title: title.toLowerCase(), description: "另一端定义" },
      { id: "first", title: "后续同 ID 定义", description: "保持原有优先级" }
    ]);
    expect(merged.find(({ id }) => id === "first")?.title).toBe(title);
    const renamed = merged.find(({ id }) => id === "second")!;
    expect(renamed.title.length).toBeLessThanOrEqual(120);
    expect(renamed.title.endsWith("（2）")).toBe(true);
  });
});
