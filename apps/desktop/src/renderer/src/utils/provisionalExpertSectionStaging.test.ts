import { describe, expect, it } from "vitest";
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
