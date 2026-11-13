import { describe, expect, it } from "vitest";
import {
  DocumentVersionOriginSchema,
  DocumentVersionSummarySchema,
  DocumentVersionTargetSchema,
  RestoreDocumentVersionInputSchema
} from "./document-versions";
import {
  GeneralSettingsSchema,
  createDefaultGeneralSettings
} from "./general-settings";

describe("document version contracts", () => {
  it.each([
    { workspace: "catalog", bookId: "book" },
    { workspace: "long", bookId: "book" },
    { workspace: "unknown", bookId: "book", fileId: "file" },
    { workspace: "catalog", bookId: "book", documentId: "doc", path: "other" }
  ])("rejects invalid targets: %j", (target) => {
    expect(DocumentVersionTargetSchema.safeParse(target).success).toBe(false);
  });

  it("rejects empty or oversized origins and unknown version kinds", () => {
    for (const summary of ["   ", "甲".repeat(121)]) {
      expect(
        DocumentVersionOriginSchema.safeParse({
          sessionId: "s",
          runId: "r",
          summary
        }).success
      ).toBe(false);
    }
    const version = {
      id: "v1-12345678",
      seq: 1,
      kind: "pre_conversation",
      createdAt: "2026-11-11T12:00:00.000Z",
      updatedAt: "2026-11-11T12:00:00.000Z",
      sha256: "a".repeat(64),
      charCount: 2
    };
    expect(DocumentVersionSummarySchema.safeParse(version).success).toBe(true);
    expect(
      DocumentVersionSummarySchema.safeParse({ ...version, kind: "manual" })
        .success
    ).toBe(false);
    expect(
      DocumentVersionSummarySchema.safeParse({
        ...version,
        kind: "conversation"
      }).success
    ).toBe(false);
    expect(
      DocumentVersionSummarySchema.safeParse({ ...version, kind: "restore" })
        .success
    ).toBe(false);
    expect(
      RestoreDocumentVersionInputSchema.safeParse({
        target: { workspace: "catalog", bookId: "book", documentId: "doc" },
        versionId: "../../outside",
        expectedCurrentSha256: "invalid"
      }).success
    ).toBe(false);
  });

  it("defaults legacy settings to disabled and trims the summary", () => {
    const { versionHistoryEnabled: _, ...legacy } =
      createDefaultGeneralSettings();
    expect(GeneralSettingsSchema.parse(legacy).versionHistoryEnabled).toBe(
      false
    );
    expect(
      DocumentVersionOriginSchema.parse({
        sessionId: "s",
        runId: "r",
        summary: "  修改章节  "
      }).summary
    ).toBe("修改章节");
  });
});
