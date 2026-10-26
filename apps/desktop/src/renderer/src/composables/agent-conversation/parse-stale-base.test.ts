import { describe, expect, it } from "vitest";
import { parseStoredStaleBase } from "./parse-stale-base";

describe("parseStoredStaleBase", () => {
  it("restores short and long markers with the user's decision", () => {
    expect(
      parseStoredStaleBase({
        detectedAt: "2026-10-19T01:00:00.000Z",
        currentRevision: "v1:3:0123abcd",
        resolution: "kept-user"
      })
    ).toEqual({
      detectedAt: "2026-10-19T01:00:00.000Z",
      currentRevision: "v1:3:0123abcd",
      resolution: "kept-user"
    });
    expect(
      parseStoredStaleBase({
        detectedAt: "2026-10-19T01:00:00.000Z",
        currentSha256ByFileId: { file_body: "b".repeat(64) }
      })
    ).toEqual({
      detectedAt: "2026-10-19T01:00:00.000Z",
      currentSha256ByFileId: { file_body: "b".repeat(64) }
    });
  });

  it("drops unreadable markers so accept checks the base again", () => {
    for (const value of [
      undefined,
      "stale",
      { detectedAt: "not a date" },
      { detectedAt: "2026-10-19T01:00:00.000Z", currentRevision: 3 },
      {
        detectedAt: "2026-10-19T01:00:00.000Z",
        currentSha256ByFileId: { file_body: "short" }
      },
      { detectedAt: "2026-10-19T01:00:00.000Z", resolution: "merged" }
    ]) {
      expect(parseStoredStaleBase(value)).toBeUndefined();
    }
  });
});
