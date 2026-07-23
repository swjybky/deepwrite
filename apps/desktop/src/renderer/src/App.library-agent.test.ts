import { describe, expect, it } from "vitest";
import appSource from "./App.vue?raw";

describe("library management agent wiring", () => {
  it("routes selected libraries into a bounded management context", () => {
    expect(appSource).toContain("activeAgentDocumentForSelection(");
    expect(appSource).toContain("buildLibraryEntryComposerReferences(");
    expect(appSource).toContain("按需加载的方法");
    expect(appSource).toContain("libraryWorkspace: activeLibraryAgentContext.value");
    expect(appSource).toContain("activeAgentDocument.value");
  });

  it("stages library tool mutations and persists accepted entry changes", () => {
    expect(appSource).toContain('event.type === "library.editor_mutation"');
    expect(appSource).toContain("stageLibraryEditProposal(event)");
    expect(appSource).toContain("window.deepwrite.catalog.saveLibraryEntry({");
    expect(appSource).toContain("window.deepwrite.catalog.createLibraryEntry({");
    expect(appSource).toContain("currentLibraryProjectRevisionMatches(");
    expect(appSource).toContain("applySavedLibraryEntry(");
    expect(appSource).toContain("applyCreatedLibraryEntry(");
  });

  it("loads and saves both library agent settings without loading the catalog again", () => {
    expect(appSource).toContain("window.deepwrite.libraryAgents.list()");
    expect(appSource).toContain("window.deepwrite.libraryAgents.save(");
    expect(appSource).toContain("window.deepwrite.libraryAgents.reset(");
    expect(appSource).not.toMatch(
      /saveLibraryAgentSettings[\s\S]{0,900}catalog\.snapshot\(/u
    );
  });
});
