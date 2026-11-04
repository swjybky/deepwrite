import type { AgentRuntimeEvent } from "@deepwrite/pi-runtime-adapter";
import { describe, expect, it } from "vitest";
import { AgentRunRegistry } from "./agent-run-registry";

function heldRuns() {
  const registry = new AgentRunRegistry();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const start = (sessionId: string, extras = false) => {
    expect(registry.admissionError(sessionId, extras)).toBeUndefined();
    const run = registry.begin(sessionId, extras);
    async function* events(): AsyncGenerator<AgentRuntimeEvent> {
      await gate;
      yield* [];
    }
    registry.stream(
      {
        ...run,
        sessionId,
        promptRequestId: sessionId,
        runtime: {
          provider: "deepwrite",
          model: "deepwrite-writing-faux",
          mode: "local-faux"
        }
      },
      events(),
      sessionId,
      () => undefined
    );
    return run.runId;
  };
  return {
    registry,
    start,
    async finish() {
      release();
      await registry.shutdown();
    }
  };
}

describe("creation run admission", () => {
  it("keeps five sessions live, isolates stops, and bounds total capacity", async () => {
    const test = heldRuns();
    try {
      const ids = Array.from({ length: 8 }, (_, i) => test.start(`book-${i}`));
      expect(test.registry.activeRun("book-4")).toBe(ids[4]);
      expect(test.registry.admissionError("book-8", false)?.code).toBe(
        "agent.capacity_reached"
      );
      expect(test.registry.admissionError("book-0", false)?.code).toBe(
        "agent.session_busy"
      );
      expect(test.registry.abort("book-1", ids[0]!)).toBe(false);
      expect(test.registry.abort("book-1", ids[1]!)).toBe(true);
      expect(test.registry.activeRun("book-0")).toBe(ids[0]);
    } finally {
      await test.finish();
    }
  });

  it("preserves the three-analysis limit without blocking creation capacity", async () => {
    const test = heldRuns();
    try {
      for (let i = 0; i < 3; i++) test.start(`analysis-${i}`, true);
      expect(test.registry.admissionError("analysis-3", true)?.code).toBe(
        "agent.extras_capacity_reached"
      );
      test.start("book");
    } finally {
      await test.finish();
    }
  });
});
