import { describe, expect, it } from "vitest";
import type { LongBookDecompositionJob } from "@deepwrite/contracts";
import { decompositionChapterReadingUnitIds } from "./unit-persistence";

const jobWithUnits = (ids: string[]) =>
  ({
    units: Object.fromEntries(ids.map((id) => [id, {}]))
  }) as unknown as LongBookDecompositionJob;

describe("reading unit lookup", () => {
  it("resolves a normal chapter without scanning unrelated units", () => {
    const job = jobWithUnits([
      "reading:chapter-7",
      ...Array.from({ length: 10_000 }, (_, index) => `reading:other-${index}`)
    ]);

    expect(decompositionChapterReadingUnitIds(job, "chapter-7")).toEqual([
      "reading:chapter-7"
    ]);
  });

  it("resolves every contiguous segment of an oversized chapter", () => {
    const job = jobWithUnits([
      "reading:chapter-7:0",
      "reading:chapter-7:1",
      "reading:chapter-7:2",
      "reading:chapter-8:0"
    ]);

    expect(decompositionChapterReadingUnitIds(job, "chapter-7")).toEqual([
      "reading:chapter-7:0",
      "reading:chapter-7:1",
      "reading:chapter-7:2"
    ]);
  });
});
