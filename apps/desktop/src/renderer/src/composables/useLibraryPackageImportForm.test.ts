import { describe, expect, it } from "vitest";
import { nextTick, shallowRef } from "vue";
import type {
  LibraryPackagePreview,
  LibraryPackagePreviewLibrary
} from "@deepwrite/contracts";
import { useLibraryPackageImportForm } from "./useLibraryPackageImportForm";

function library(
  key: string,
  title: string,
  kind: string,
  overrides: Partial<LibraryPackagePreviewLibrary> = {}
): LibraryPackagePreviewLibrary {
  return {
    key,
    title,
    kind,
    kindEditable: true,
    libraryType: "short",
    entryCount: 1,
    contentBytes: 10,
    stageHints: [],
    blocked: null,
    ...overrides
  };
}

const preview: LibraryPackagePreview = {
  sourceName: "我的资料",
  sourceKind: "directory",
  recognition: "folder",
  domain: "material",
  group: { title: "我的资料", suggested: true },
  libraries: [
    library("lib-1", "人设", "character"),
    library("lib-2", "剧情", "plot"),
    library("lib-3", "更多剧情", "plot"),
    library("lib-4", "超大", "draft", { blocked: "bytes", kindEditable: false })
  ],
  skipped: {
    unsupported: 0,
    empty: 0,
    tooLarge: 0,
    undecodable: 0,
    missing: 0,
    unassigned: 0,
    limit: 0
  },
  skippedFiles: [],
  notes: []
};

describe("useLibraryPackageImportForm", () => {
  it("re-checks the group as kinds change and builds Core choices", async () => {
    const source = shallowRef<LibraryPackagePreview | undefined>(undefined);
    const form = useLibraryPackageImportForm({
      preview: () => source.value,
      existingTitles: () => ["剧情"]
    });
    source.value = preview;
    await nextTick();

    expect(form.rows.value.map(({ include }) => include)).toEqual([
      true,
      true,
      true,
      false
    ]);
    expect(form.groupProblem.value).toBe("duplicateKind");
    expect(form.groupEnabled.value).toBe(false);
    expect(form.plannedTitles.value.get("lib-2")).toBe("剧情 (2)");

    form.updateRow("lib-3", { kind: "gimmick" });
    expect(form.groupProblem.value).toBeNull();
    expect(form.groupEnabled.value).toBe(true);

    form.updateRow("lib-1", { title: "  " });
    expect(form.choices()).toEqual({
      libraries: [
        { key: "lib-1", include: true, title: "人设", kind: "character" },
        { key: "lib-2", include: true, title: "剧情", kind: "plot" },
        { key: "lib-3", include: true, title: "更多剧情", kind: "gimmick" },
        { key: "lib-4", include: false, title: "超大" }
      ],
      createGroup: true,
      groupTitle: "我的资料"
    });

    form.groupTitle.value = " ";
    expect(form.ready.value).toBe(false);
    form.createGroup.value = false;
    expect(form.ready.value).toBe(true);
    expect(form.choices().createGroup).toBe(false);
  });
});
