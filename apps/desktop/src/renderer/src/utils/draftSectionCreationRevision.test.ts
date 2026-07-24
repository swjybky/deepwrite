import { describe, expect, it } from "vitest";
import {
  advanceDraftSectionCreationRevision,
  expectedDraftSectionCreationRevision
} from "./draftSectionCreationRevision";

describe("draft section creation revision chain", () => {
  it("continues same-run proposals from the last real directory revision", () => {
    const first = advanceDraftSectionCreationRevision(
      "directory-v1",
      "directory-v2",
      undefined
    );
    const second = advanceDraftSectionCreationRevision(
      "directory-v1",
      "directory-v3",
      first
    );

    expect(expectedDraftSectionCreationRevision("directory-v1", first)).toBe(
      "directory-v2"
    );
    expect(expectedDraftSectionCreationRevision("directory-v1", second)).toBe(
      "directory-v3"
    );
  });

  it("does not reuse a cursor that belongs to another base directory", () => {
    const cursor = advanceDraftSectionCreationRevision(
      "directory-v1",
      "directory-v2",
      undefined
    );

    expect(expectedDraftSectionCreationRevision("external-v4", cursor)).toBe(
      "external-v4"
    );
  });
});
