import { describe, expect, it } from "vitest";
import { acquireConversationOperation } from "./conversation-operation-guard";
import type { ActiveRun } from "./command-types";

describe("Main conversation operation ownership", () => {
  it("blocks deletion while prompt acceptance is still pending and releases after failure", () => {
    const runs = new Map<string, ActiveRun>();
    const prompt = acquireConversationOperation(runs, "session", "prompt")!;
    expect(
      acquireConversationOperation(runs, "session", "management")
    ).toBeUndefined();
    const unrelated = acquireConversationOperation(runs, "other", "management");
    expect(unrelated).toBeTypeOf("function");
    unrelated!();
    prompt();
    prompt();
    const deletion = acquireConversationOperation(
      runs,
      "session",
      "management"
    )!;
    expect(deletion).toBeTypeOf("function");
    expect(
      acquireConversationOperation(runs, "session", "prompt")
    ).toBeUndefined();
    deletion();
    expect(acquireConversationOperation(runs, "session", "prompt")).toBeTypeOf(
      "function"
    );
  });
  it("consults authoritative running sessions even when Renderer reports idle", () => {
    const runs = new Map<string, ActiveRun>([
      ["run", { sessionId: "session" } as ActiveRun]
    ]);
    expect(
      acquireConversationOperation(runs, "session", "management")
    ).toBeUndefined();
    runs.clear();
    expect(
      acquireConversationOperation(runs, "session", "management")
    ).toBeTypeOf("function");
  });
});
