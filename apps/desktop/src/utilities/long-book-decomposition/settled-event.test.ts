import { describe, expect, it } from "vitest";
import type { CommandEnvelope, CommandResult } from "@deepwrite/contracts";
import { createDecompositionSettledEvents } from "./settled-event";

const command = {
  id: "cmd-1",
  type: "longBookDecomposition.getJob",
  context: { correlationId: "corr-1" }
} as unknown as CommandEnvelope;

function job(
  status: string,
  extra: Record<string, unknown> = {}
): CommandResult {
  return {
    status: "accepted",
    requestId: "cmd-1",
    payload: { id: "job-1", status, units: {}, ...extra }
  } as CommandResult;
}

describe("decomposition settled events", () => {
  it("reports a task that finishes after it was seen running", () => {
    const settled = createDecompositionSettledEvents();
    expect(settled(command, job("running"))).toBeUndefined();
    expect(settled(command, job("completed"))?.payload).toEqual({
      jobId: "job-1",
      outcome: "completed"
    });
  });

  it("reports a failure and a usage pause, but not a stop the user asked for", () => {
    const settled = createDecompositionSettledEvents();
    settled(command, job("running"));
    expect(
      settled(command, job("failed", { lastError: "x" }))?.payload
    ).toEqual({ jobId: "job-1", outcome: "failed" });
    settled(command, job("running"));
    expect(
      settled(command, job("stopped", { lastError: "用量已超过阈值" }))?.payload
    ).toEqual({ jobId: "job-1", outcome: "paused" });
    settled(command, job("running"));
    expect(settled(command, job("stopped"))).toBeUndefined();
  });

  it("does not repeat while the task stays settled", () => {
    const settled = createDecompositionSettledEvents();
    settled(command, job("idle"));
    expect(settled(command, job("completed"))).toBeDefined();
    expect(settled(command, job("completed"))).toBeUndefined();
  });

  it("stays silent for a finished task it never saw running, such as after a restart", () => {
    const settled = createDecompositionSettledEvents();
    expect(settled(command, job("completed"))).toBeUndefined();
    expect(settled(command, job("failed"))).toBeUndefined();
  });

  it("ignores rejected results and payloads that are not tasks", () => {
    const settled = createDecompositionSettledEvents();
    settled(command, job("running"));
    expect(
      settled(command, {
        status: "rejected",
        requestId: "cmd-1",
        error: { code: "x", message: "y" }
      } as CommandResult)
    ).toBeUndefined();
    expect(
      settled(command, {
        status: "accepted",
        requestId: "cmd-1",
        payload: [{ id: "job-1", status: "completed", units: {} }]
      } as CommandResult)
    ).toBeUndefined();
    expect(
      settled(command, {
        status: "accepted",
        requestId: "cmd-1",
        payload: { id: "job-1" }
      } as CommandResult)
    ).toBeUndefined();
  });

  it("tracks tasks independently", () => {
    const settled = createDecompositionSettledEvents();
    settled(command, job("running"));
    const other = {
      status: "accepted",
      requestId: "cmd-2",
      payload: { id: "job-2", status: "completed", units: {} }
    } as CommandResult;
    expect(settled(command, other)).toBeUndefined();
    expect(settled(command, job("completed"))?.payload.jobId).toBe("job-1");
  });
});
