import {
  createEnvelope,
  type AgentRuntimeRef,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { AgentRuntimeEvent } from "@deepwrite/pi-runtime-adapter";
import { createId } from "@deepwrite/shared";
import { toEventEnvelope } from "./agent-event-envelope";

const MAX_ACTIVE_RUNS = 8;
/** Preserve the analysis limit while allowing concurrent creation sessions. */
const MAX_ACTIVE_EXTRAS_RUNS = 3;

export interface StreamedRun {
  runId: string;
  sessionId: string;
  runtime: AgentRuntimeRef;
  promptRequestId: string;
}

export interface RunAdmissionError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Active runs of the Agent Utility for every domain: one run per session,
 * a shared capacity limit, aborts, and forwarding of runtime events.
 */
export class AgentRunRegistry {
  private readonly streams = new Set<Promise<void>>();
  private readonly terminalRuns = new Set<string>();
  private readonly sessionRuns = new Map<string, string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly extrasRuns = new Set<string>();

  activeRun(sessionId: string): string | undefined {
    return this.sessionRuns.get(sessionId);
  }

  isExtrasRun(runId: string): boolean {
    return this.extrasRuns.has(runId);
  }

  admissionError(
    sessionId: string,
    extras: boolean
  ): RunAdmissionError | undefined {
    const activeRunId = this.sessionRuns.get(sessionId);
    if (activeRunId) {
      return {
        code: "agent.session_busy",
        message: "当前会话已有一轮智能体运行尚未结束。",
        details: { activeRunId }
      };
    }
    if (this.streams.size >= MAX_ACTIVE_RUNS) {
      return {
        code: "agent.capacity_reached",
        message: "本地智能体并发运行数量已达到上限。"
      };
    }
    if (extras && this.extrasRuns.size >= MAX_ACTIVE_EXTRAS_RUNS) {
      return {
        code: "agent.extras_capacity_reached",
        message: "更多功能同时运行的分析数量已达到上限，请等待其他分析完成。"
      };
    }
    return undefined;
  }

  begin(
    sessionId: string,
    extras: boolean
  ): { runId: string; signal: AbortSignal } {
    const runId = createId("run");
    const controller = new AbortController();
    this.sessionRuns.set(sessionId, runId);
    this.controllers.set(runId, controller);
    if (extras) this.extrasRuns.add(runId);
    return { runId, signal: controller.signal };
  }

  /** Aborts the session's active run; false when it is not that run. */
  abort(sessionId: string, runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (this.sessionRuns.get(sessionId) !== runId || !controller) return false;
    controller.abort();
    return true;
  }

  stream(
    run: StreamedRun,
    events: AsyncIterable<AgentRuntimeEvent>,
    correlationId: string,
    emitEvent: (event: SystemEventEnvelope) => void
  ): void {
    const stream = (async () => {
      try {
        // Let the command handler post its acceptance before restoration can
        // issue authorized Core reads. Main binds the run when it receives it.
        await new Promise<void>((resolve) => setImmediate(resolve));
        for await (const event of events) {
          if (this.terminalRuns.has(run.runId)) {
            continue;
          }
          emitEvent(toEventEnvelope(event, correlationId));
          if (
            event.type === "agent.completed" ||
            event.type === "agent.error"
          ) {
            this.terminalRuns.add(run.runId);
          }
        }
      } catch (error: unknown) {
        if (!this.terminalRuns.has(run.runId)) {
          this.terminalRuns.add(run.runId);
          emitEvent(
            createEnvelope(
              "agent.error",
              {
                sessionId: run.sessionId,
                runId: run.runId,
                code: "agent.stream_failed",
                message:
                  error instanceof Error
                    ? error.message
                    : "Agent stream failed.",
                details: {
                  kind: error instanceof Error ? error.name : "unknown"
                },
                runtime: run.runtime
              },
              {
                id: createId("evt"),
                context: {
                  correlationId,
                  sessionId: run.sessionId,
                  runId: run.runId
                }
              }
            )
          );
        }
      } finally {
        this.terminalRuns.delete(run.runId);
        this.controllers.delete(run.runId);
        this.extrasRuns.delete(run.runId);
        if (this.sessionRuns.get(run.sessionId) === run.runId) {
          this.sessionRuns.delete(run.sessionId);
        }
        emitEvent(
          createEnvelope(
            "agent.run_drained",
            {
              sessionId: run.sessionId,
              runId: run.runId,
              promptRequestId: run.promptRequestId
            },
            {
              id: createId("evt"),
              context: {
                correlationId,
                sessionId: run.sessionId,
                runId: run.runId
              }
            }
          )
        );
      }
    })();

    this.streams.add(stream);
    void stream.then(
      () => this.streams.delete(stream),
      () => this.streams.delete(stream)
    );
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    if (this.streams.size === 0) {
      return;
    }
    await Promise.race([
      Promise.allSettled([...this.streams]),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000))
    ]);
  }
}
