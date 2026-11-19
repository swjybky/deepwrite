import { describe, expect, it } from "vitest";
import longProposalSource from "./LongProposalReview.vue?raw";
import longWorkspaceEditorSource from "./LongWorkspaceEditor.vue?raw";

describe("scoped global style selectors", () => {
  it("keeps the complete descendant selector inside :global()", () => {
    for (const source of [longProposalSource, longWorkspaceEditorSource]) {
      expect(source).not.toMatch(/:global\((?:[^()]|\([^)]*\))+\)\s+(?:\.|:)/);
    }
  });
});
