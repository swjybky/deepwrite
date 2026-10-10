import { describe, expect, it } from "vitest";
import { orderByLibraryQuota } from "./material-query-scope";

const entries = (libraryId: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    libraryId,
    id: `${libraryId}:${index}`
  }));

describe("run catalog first page", () => {
  it("shows every library's leading entries when the catalog overflows", () => {
    const candidates = ["character", "gimmick", "plot", "draft", "other"]
      .flatMap((library) => entries(library, 30))
      .filter(
        ({ libraryId, id }) => libraryId !== "gimmick" || id < "gimmick:3"
      );
    const ordered = orderByLibraryQuota(candidates);
    const firstPage = ordered.slice(0, 64);
    for (const library of ["character", "gimmick", "plot", "draft", "other"])
      expect(firstPage.map(({ id }) => id)).toContain(`${library}:0`);
    expect(
      firstPage.filter(({ libraryId }) => libraryId === "other")
    ).toHaveLength(12);
    expect(new Set(ordered.map(({ id }) => id)).size).toBe(candidates.length);
  });

  it("keeps the original order for one library or a catalog that fits", () => {
    const single = entries("plot", 200);
    expect(orderByLibraryQuota(single)).toEqual(single);
    const small = [...entries("character", 40), ...entries("other", 20)];
    expect(orderByLibraryQuota(small)).toEqual(small);
  });

  it("is a stable permutation, so cursor pages neither repeat nor skip", () => {
    const candidates = [...entries("character", 90), ...entries("other", 50)];
    const ordered = orderByLibraryQuota(candidates);
    expect(orderByLibraryQuota(candidates)).toEqual(ordered);
    const pages = [0, 32, 64, 96, 128].flatMap((start) =>
      ordered.slice(start, start + 32).map(({ id }) => id)
    );
    expect(pages).toEqual(ordered.map(({ id }) => id));
    expect(
      ordered.slice(0, 64).filter(({ libraryId }) => libraryId === "other")
    ).toHaveLength(32);
  });
});
