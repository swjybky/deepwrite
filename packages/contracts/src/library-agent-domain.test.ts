import { describe, it, expect } from "vitest";
import { LibraryAgentWorkspaceSnapshotSchema } from "./library-agent";
import {
  conversationHistoryKeyFor,
  RendererStateKeySchema
} from "./renderer-state-key";
import { conversationSyncBookKeySchema } from "./device-sync/conversation/schemas";

const revision = "v1:0:00000000";
function workspace() {
  return {
    domain: "material",
    libraryId: "focus",
    title: "Focus",
    libraryType: "short",
    kind: "mixed",
    overviewDocumentId: "overview",
    overview: "",
    overviewRevision: revision,
    readOnly: false,
    readableLibraries: Array.from({ length: 12 }, (_, index) => ({
      libraryId: index === 0 ? "focus" : `peer-${index}`,
      title: `Library ${index}`,
      kind: "mixed",
      readOnly: false,
      entryCount: 1
    })),
    entries: [
      {
        id: "peer-entry",
        documentId: "doc",
        title: "Entry",
        stageId: "character",
        content: "",
        revision,
        readOnly: false,
        sourceLibraryId: "peer-1",
        sourceLibraryTitle: "Peer"
      }
    ]
  };
}
describe("domain library workspace contract", () => {
  it("accepts a domain index larger than the former group limit and writable peer entries", () => {
    expect(
      LibraryAgentWorkspaceSnapshotSchema.safeParse(workspace()).success
    ).toBe(true);
  });
  it("rejects missing owners, missing focus and inconsistent read-only flags", () => {
    const source = workspace();
    expect(
      LibraryAgentWorkspaceSnapshotSchema.safeParse({
        ...source,
        readableLibraries: source.readableLibraries.slice(1)
      }).success
    ).toBe(false);
    expect(
      LibraryAgentWorkspaceSnapshotSchema.safeParse({
        ...source,
        entries: [{ ...source.entries[0], sourceLibraryId: "unknown" }]
      }).success
    ).toBe(false);
    expect(
      LibraryAgentWorkspaceSnapshotSchema.safeParse({
        ...source,
        entries: [{ ...source.entries[0], readOnly: true }]
      }).success
    ).toBe(false);
  });
  it("stores domain keys locally while keeping work-only sync scope", () => {
    expect(
      RendererStateKeySchema.safeParse(
        conversationHistoryKeyFor("library:material")
      ).success
    ).toBe(true);
    expect(
      RendererStateKeySchema.safeParse(
        conversationHistoryKeyFor("library:skill")
      ).success
    ).toBe(true);
    expect(
      conversationSyncBookKeySchema.safeParse("library:material").success
    ).toBe(false);
  });
});
