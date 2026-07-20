import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES,
  importLegacyLibraryArchives
} from "./legacy-library-import-batch";

describe("legacy library archive batch import", () => {
  it("enables selecting multiple zip archives", () => {
    expect(LEGACY_LIBRARY_FILE_SELECTION_PROPERTIES).toEqual([
      "openFile",
      "multiSelections"
    ]);
  });

  it("imports every selected archive and keeps going after a failure", async () => {
    const importArchive = vi.fn(async (archivePath: string) => {
      if (archivePath.endsWith("损坏.zip")) {
        throw new Error("缺少 metadata.json。");
      }
      const id = archivePath.includes("素材一") ? "material-1" : "material-2";
      return {
        id,
        title: id === "material-1" ? "素材一" : "素材二",
        materialType: "short",
        materialKind: "character",
        parentGenre: "",
        subGenre: "",
        overview: "",
        entries: [],
        projectRevision: 1,
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T10:00:00.000Z"
      };
    });

    const result = await importLegacyLibraryArchives(
      ["/exports/素材一.zip", "/exports/损坏.zip", "/exports/素材二.zip"],
      importArchive
    );

    expect(importArchive).toHaveBeenCalledTimes(3);
    expect(result.imported.map(({ id }) => id)).toEqual([
      "material-1",
      "material-2"
    ]);
    expect(result.failures).toEqual([
      { fileName: "损坏.zip", message: "缺少 metadata.json。" }
    ]);
  });
});
