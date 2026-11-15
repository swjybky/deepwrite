import { describe, expect, it } from "vitest";
import type { LongWorldbuildingCategory } from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import {
  buildLongWorldbuildingDirectorySnapshot,
  buildLongWorldbuildingFocusSnapshot
} from "./longWorldbuildingAgentContext";

const file = (id: string) => ({
  id: `file_${id}`,
  path: `long/test/${id}.md`,
  updatedAt: "2026-07-30T10:00:00.000Z"
});

function category(order: number, count: number): LongWorldbuildingCategory {
  return {
    id: `world_${order}`,
    title: `分类${order}`,
    order,
    format: "list",
    contentAuthority: "files",
    overview: file(`overview_${order}`),
    items: Array.from({ length: count }, (_, index) => ({
      id: `worlditem_${order}_${index + 1}`,
      title: `条目${index + 1}`,
      order: index + 1,
      file: file(`item_${order}_${index + 1}`)
    })).reverse()
  };
}

function selection(): LongWorkspaceSelection {
  return {
    key: "worldbuilding:world_1",
    root: "worldbuilding",
    title: "势力",
    breadcrumbs: ["合成书", "世界观", "势力"],
    worldbuildingFormat: "list",
    worldbuildingItems: [
      { id: "worlditem_watch", title: "守夜人", order: 1, file: file("watch") }
    ],
    files: [
      { role: "overview", label: "概览", file: file("overview") },
      { role: "content", label: "守夜人", file: file("watch") }
    ],
    preferredRole: "content"
  };
}

describe("long worldbuilding agent context", () => {
  it.each([1, 200, 201])(
    "bounds each category while preserving order and counts (%i)",
    (count) => {
      const snapshot = buildLongWorldbuildingDirectorySnapshot([
        category(2, count),
        category(1, count)
      ]);
      expect(snapshot.categories.map(({ categoryId }) => categoryId)).toEqual([
        "world_1",
        "world_2"
      ]);
      for (const entry of snapshot.categories) {
        if (entry.format !== "list") throw new Error("Expected list category");
        expect(entry.items).toHaveLength(Math.min(count, 200));
        expect(entry.items[0]!.order).toBe(1);
        expect(entry.itemCount).toBe(count);
        expect(entry.omittedItemCount).toBe(Math.max(count - 200, 0));
      }
      expect(JSON.stringify(snapshot)).not.toContain("file_");
    }
  );

  it("keeps the total item limit and all category entry points", () => {
    const snapshot = buildLongWorldbuildingDirectorySnapshot(
      Array.from({ length: 11 }, (_, index) => category(index + 1, 201))
    );
    expect(snapshot.categories).toHaveLength(11);
    const counts = snapshot.categories.map((entry) =>
      entry.format === "list" ? entry.items.length : 0
    );
    expect(counts.reduce((total, count) => total + count, 0)).toBe(2_000);
    expect(counts.at(-1)).toBe(0);
    expect(snapshot.categories.at(-1)).toMatchObject({
      itemCount: 201,
      omittedItemCount: 201
    });
  });

  it("captures an item id without loading its text or overview", () => {
    expect(
      buildLongWorldbuildingFocusSnapshot({
        selection: selection(),
        activeFileId: "file_watch"
      })
    ).toEqual({
      categoryId: "world_1",
      categoryTitle: "势力",
      format: "list",
      currentStage: { kind: "item", itemId: "worlditem_watch", title: "守夜人" }
    });
  });

  it("captures list overview and text category locations", () => {
    const current = selection();
    expect(
      buildLongWorldbuildingFocusSnapshot({
        selection: current,
        activeFileId: "file_overview"
      })
    ).toMatchObject({
      categoryId: "world_1",
      currentStage: { kind: "overview", title: "概览" }
    });
    current.worldbuildingFormat = "text";
    expect(
      buildLongWorldbuildingFocusSnapshot({
        selection: current,
        activeFileId: "file_watch"
      })
    ).toEqual({
      categoryId: "world_1",
      categoryTitle: "势力",
      format: "text",
      currentStage: { kind: "text", title: "势力" }
    });
  });

  it("ignores a missing file or a non-category selection", () => {
    expect(
      buildLongWorldbuildingFocusSnapshot({
        selection: selection(),
        activeFileId: "file_missing"
      })
    ).toBeUndefined();
    expect(
      buildLongWorldbuildingFocusSnapshot({
        selection: { ...selection(), key: "worldbuilding:reveals" },
        activeFileId: "file_watch"
      })
    ).toBeUndefined();
  });
});
