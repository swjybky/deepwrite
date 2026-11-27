import { describe, expect, it } from "vitest";
import type { LongCommandExecutor } from "../index";
import {
  fixtureIndex,
  profile,
  workspace
} from "../long-agent-tools.test-support";
import { createLongToolContext } from "./context";
import { createLongWorkspaceToolSharedState } from "./proposal-overlay";
import { buildSearchTool } from "./tool-search";

describe("long-agent-tools concurrent subagent context isolation", () => {
  it("generates distinct command ids across sibling contexts sharing one runId and coalesces clean index loads", async () => {
    const index = fixtureIndex();
    const commands: { id: string; type: string }[] = [];
    let resolveIndex!: () => void;
    let indexCalls = 0;

    const executor: LongCommandExecutor = async (command) => {
      commands.push({ id: command.id, type: command.type });
      if (command.type === "long.getWorkspaceIndex") {
        indexCalls += 1;
        if (indexCalls === 1) {
          await new Promise<void>((resolve) => {
            resolveIndex = resolve;
          });
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            workspaceIndex: index
          }
        };
      }
      if (command.type === "long.search") {
        return {
          status: "accepted",
          requestId: command.id,
          payload: {
            bookId: index.bookId,
            query: "主角",
            scope: "all",
            hits: [],
            nextCursor: null
          }
        };
      }
      throw new Error(`Unexpected command ${command.type}`);
    };

    const activeProfile = profile("long");
    const activeWorkspace = workspace("long", "plot_design");
    const sharedState = createLongWorkspaceToolSharedState();
    const base = {
      workspace: activeWorkspace,
      profile: activeProfile,
      sessionId: "sess_1",
      runId: "run_shared_1",
      executor,
      sharedState
    };

    const ctxA = createLongToolContext(base);
    const ctxB = createLongToolContext(base);
    const abortedController = new AbortController();

    const loadA = ctxA.loadIndex(abortedController.signal);
    const loadB = ctxB.loadIndex();
    abortedController.abort();

    // Caller A rejects immediately without blocking on or cancelling sibling caller B.
    await expect(loadA).rejects.toThrow(/取消|abort/i);
    resolveIndex();

    await expect(loadB).resolves.toMatchObject({ bookId: index.bookId });
    expect(indexCalls).toBe(1);

    // Search triggers reloadIndex cleanly across sibling contexts with distinct command IDs.
    const searchA = buildSearchTool(ctxA);
    const searchB = buildSearchTool(ctxB);
    await Promise.all([
      searchA.execute("t1", { query: "主角" }),
      searchB.execute("t2", { query: "主角" })
    ]);

    const ids = commands.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
