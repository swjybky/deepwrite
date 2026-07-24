import { describe, expect, it } from "vitest";
import source from "./App.vue?raw";

describe("App agent chapter-file creation", () => {
  it("stages one structural proposal and persists every accepted chapter in order", () => {
    expect(source).toContain(
      'mutationTarget?.kind === "expert-draft-section-creation"'
    );
    expect(source).toContain("draftSectionCreationTarget: {");
    expect(source).toContain("acceptDraftSectionCreationProposal(");
    expect(source).toContain(
      "for (const section of target.sections)"
    );
    expect(source).toContain(
      "await window.deepwrite.catalog.createDraftSection({"
    );
    expect(source).toContain(
      "baseProjectRevision: book.projectRevision + createdCount"
    );
    expect(source).toContain(
      "afterSectionId = created.id;"
    );
    expect(source).toContain(
      "applyCatalogSnapshot(await window.deepwrite.catalog.snapshot())"
    );
    expect(source).toContain(
      "expectedDraftSectionCreationBaseRevision(proposal)"
    );
    expect(source).toContain(
      "rememberAcceptedDraftSectionCreation(proposal, savedDirectoryRevision)"
    );
  });
});
