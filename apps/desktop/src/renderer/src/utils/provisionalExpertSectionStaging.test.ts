import { describe, expect, it } from "vitest";
import {
  advanceDraftSectionCreationRevision,
  draftSectionCreationRevisionKey,
  expectedDraftSectionCreationRevision
} from "./draftSectionCreationRevision";
import { resolveProvisionalWriteStagingMode } from "./provisionalExpertSectionStaging";

describe("resolveProvisionalWriteStagingMode", () => {
  it("prefers provisional staging while creation is still pending", () => {
    expect(
      resolveProvisionalWriteStagingMode({
        hasPendingCreation: true,
        provisionalSectionId: "pending:section:1",
        resolvedSectionId: "pending:section:1"
      })
    ).toBe("provisional");
    expect(
      resolveProvisionalWriteStagingMode({
        hasPendingCreation: true,
        provisionalSectionId: "pending:section:1",
        // Mapping should not win over a still-pending creation card.
        resolvedSectionId: "section-real-1"
      })
    ).toBe("provisional");
  });

  it("stages against the real file after creation was accepted mid-run", () => {
    expect(
      resolveProvisionalWriteStagingMode({
        hasPendingCreation: false,
        provisionalSectionId: "pending:section:1",
        resolvedSectionId: "section-real-1"
      })
    ).toBe("mapped-real");
  });

  it("rejects writes when creation was never accepted and no mapping exists", () => {
    expect(
      resolveProvisionalWriteStagingMode({
        hasPendingCreation: false,
        provisionalSectionId: "pending:section:1",
        resolvedSectionId: "pending:section:1"
      })
    ).toBe("unavailable");
  });
});

describe("same-run create staging revision cursor", () => {
  it("lets a later create with frozen R0 stage after an earlier accept advanced the directory", () => {
    const frozenBase = "directory-v1";
    const afterFirstAccept = advanceDraftSectionCreationRevision(
      frozenBase,
      "directory-v2",
      undefined
    );
    expect(draftSectionCreationRevisionKey("run-1", "book-1")).toBe(
      "run-1\u0000book-1"
    );

    // Staging must use the cursor-aware expected revision, not raw R0.
    expect(
      expectedDraftSectionCreationRevision(frozenBase, afterFirstAccept)
    ).toBe("directory-v2");
    expect(
      expectedDraftSectionCreationRevision(frozenBase, afterFirstAccept)
    ).not.toBe(frozenBase);
  });
});
