import type { SystemEventEnvelope } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  registerWorkspaceSystemEventRoutes,
  type WorkspaceSystemEventRouteDependencies
} from "./registerWorkspaceSystemEventRoutes";
import { createSystemEventCenter } from "./systemEventCenter";

function event(value: unknown): SystemEventEnvelope {
  return value as SystemEventEnvelope;
}

function createDependencies(order: string[] = []) {
  const conversation = {
    handleEvent: vi.fn(() => order.push("conversation"))
  };
  const dependencies: WorkspaceSystemEventRouteDependencies = {
    learningImitation: {
      handleEvent: vi.fn(() => order.push("learning"))
    },
    revisionAnalysis: { handleEvent: vi.fn() },
    shortBookAnalysis: { handleEvent: vi.fn() },
    notifyContextCompacted: vi.fn(),
    notifyCompactionFailed: vi.fn(),
    longBookAnalysis: {
      handleEvent: vi.fn(() => order.push("long-book-analysis"))
    },
    subagentAuthoring: {
      handleEvent: vi.fn(() => order.push("subagent"))
    },
    stageLongPlotDesignEditProposal: vi.fn(() => order.push("plot")),
    stageLongWorldbuildingEditProposal: vi.fn(() => order.push("world")),
    stageLongCharacterEditProposal: vi.fn(() => order.push("character")),
    stageLongDraftEditProposal: vi.fn(() => order.push("draft")),
    handleLongWorkspaceProposal: vi.fn(async () => {
      order.push("long");
    }),
    stageAgentEditProposal: vi.fn(() => order.push("workspace-edit")),
    stageLibraryEditProposal: vi.fn(() => order.push("library-edit")),
    navigateToWorkspaceStage: vi.fn(() => order.push("navigation")),
    allConversations: vi.fn(() => [conversation]),
    scheduleQueuedAgentEdits: vi.fn((predicate) => {
      expect(
        predicate({ sessionId: "session-current", runId: "run-current" })
      ).toBe(true);
      expect(
        predicate({ sessionId: "session-other", runId: "run-current" })
      ).toBe(false);
      order.push("queued-edits");
    }),
    onAsyncError: vi.fn()
  };
  return { conversation, dependencies };
}

describe("workspace system event routes", () => {
  it("preserves feature, proposal, conversation, and terminal scheduling order", () => {
    const center = createSystemEventCenter();
    const order: string[] = [];
    const { dependencies } = createDependencies(order);
    registerWorkspaceSystemEventRoutes(center, dependencies);

    center.publish(
      event({
        type: "agent.message_completed",
        payload: {
          sessionId: "session-current",
          runId: "run-current"
        }
      })
    );

    expect(order).toEqual([
      "learning",
      "long-book-analysis",
      "subagent",
      "long",
      "conversation",
      "queued-edits"
    ]);
  });

  it.each([
    [
      "plot",
      {
        type: "long.mutation_proposal",
        payload: { agentId: "long" }
      }
    ],
    ["world", { type: "long.worldbuilding_file_proposal", payload: {} }],
    ["character", { type: "long.character_file_proposal", payload: {} }],
    ["draft", { type: "long.chapter_write_proposal", payload: {} }]
  ])(
    "routes a %s proposal only through its specialized staging path",
    (expectedRoute, proposal) => {
      const center = createSystemEventCenter();
      const order: string[] = [];
      const { dependencies } = createDependencies(order);
      registerWorkspaceSystemEventRoutes(center, dependencies);

      center.publish(event(proposal));

      expect(order).toContain(expectedRoute);
      expect(dependencies.handleLongWorkspaceProposal).not.toHaveBeenCalled();
    }
  );

  it("reports rejected async proposal handlers without interrupting delivery", async () => {
    const center = createSystemEventCenter();
    const { conversation, dependencies } = createDependencies();
    const failure = new Error("proposal-handler-failed");
    dependencies.handleLongWorkspaceProposal = vi.fn(() =>
      Promise.reject(failure)
    );
    registerWorkspaceSystemEventRoutes(center, dependencies);
    const received = event({ type: "agent.usage_observed", payload: {} });

    center.publish(received);
    await Promise.resolve();

    expect(conversation.handleEvent).toHaveBeenCalledWith(received);
    expect(dependencies.onAsyncError).toHaveBeenCalledWith(failure, received);
  });

  it("releases every route once and ignores repeated disposal", () => {
    const center = createSystemEventCenter();
    const { dependencies } = createDependencies();
    const dispose = registerWorkspaceSystemEventRoutes(center, dependencies);

    dispose();
    dispose();
    center.publish(event({ type: "agent.usage_observed", payload: {} }));

    expect(dependencies.learningImitation.handleEvent).not.toHaveBeenCalled();
    expect(dependencies.allConversations).not.toHaveBeenCalled();
    expect(dependencies.handleLongWorkspaceProposal).not.toHaveBeenCalled();
  });
});
