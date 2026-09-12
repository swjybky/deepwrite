import { describe, expect, it } from "vitest";
import { validateSmokeSummary } from "../apps/desktop/scripts/package-smoke-runner.mjs";

function summary() {
  return {
    health: { status: "ok", workers: ["core", "agent", "tool"] },
    agent: { status: "ok", runtime: { mode: "local-faux" }, completed: true },
    conversation: {
      status: "ok",
      staged: true,
      reopened: false,
      chunkPages: 3,
      metadataChunkPages: 4,
      unknownRetained: true,
      proposalRetained: true
    }
  };
}

describe("packaged persistence smoke acceptance", () => {
  it("requires the database path to have been exercised instead of accepting utility health alone", () => {
    const { conversation: _conversation, ...oldSummary } = summary();
    expect(() => validateSmokeSummary(oldSummary, false)).toThrow(
      "invalid smoke summary"
    );
    expect(() => validateSmokeSummary(summary(), false)).not.toThrow();
  });
  it("requires the second application launch to read the previously committed profile", () => {
    const result = summary();
    expect(() => validateSmokeSummary(result, true)).toThrow(
      "invalid smoke summary"
    );
    result.conversation.reopened = true;
    expect(() => validateSmokeSummary(result, true)).not.toThrow();
    delete result.conversation.metadataChunkPages;
    expect(() => validateSmokeSummary(result, true)).toThrow(
      "invalid smoke summary"
    );
  });
});
