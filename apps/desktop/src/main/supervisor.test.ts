import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  type CommandEnvelope,
  type UtilityInternalCommandTarget,
  type UtilityWorkerName
} from "@deepwrite/contracts";

const electronMocks = vi.hoisted(() => ({
  fork: vi.fn()
}));

vi.mock("electron", () => ({
  utilityProcess: {
    fork: electronMocks.fork
  }
}));

import { UtilitySupervisor, type UtilitySupervisorOptions } from "./supervisor";

class FakeUtilityProcess extends EventEmitter {
  readonly posted: unknown[] = [];
  readonly pid: number;
  private exited = false;

  constructor(
    readonly worker: UtilityWorkerName,
    pid: number,
    private readonly activity: string[]
  ) {
    super();
    this.pid = pid;
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
    const kind = (message as { kind?: string }).kind ?? "unknown";
    this.activity.push(`${this.worker}:${kind}`);
    if (kind === "utility.shutdown") {
      const requestId = (message as { requestId: string }).requestId;
      queueMicrotask(() => {
        this.emit("message", {
          kind: "utility.shutdown_ack",
          worker: this.worker,
          requestId,
          timestamp: new Date().toISOString()
        });
        this.exit(0);
      });
    }
  }

  kill(): boolean {
    this.exit(null);
    return true;
  }

  dispatch(message: unknown): void {
    this.emit("message", message);
  }

  exit(code: number | null): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.emit("exit", code);
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("UtilitySupervisor internal command bridge", () => {
  const processes = new Map<UtilityWorkerName, FakeUtilityProcess>();
  const activity: string[] = [];
  const supervisors: UtilitySupervisor[] = [];
  let nextPid = 10_000;

  beforeEach(() => {
    processes.clear();
    activity.length = 0;
    nextPid = 10_000;
    electronMocks.fork.mockReset();
    electronMocks.fork.mockImplementation(
      (
        _entryPath: string,
        _args: string[],
        options: { serviceName: string; env?: NodeJS.ProcessEnv }
      ) => {
        const worker = options.serviceName.replace(
          "deepwrite-",
          ""
        ) as UtilityWorkerName;
        const child = new FakeUtilityProcess(worker, nextPid, activity);
        nextPid += 1;
        processes.set(worker, child);
        return child;
      }
    );
  });

  afterEach(async () => {
    await Promise.all(
      supervisors.splice(0).map((supervisor) => supervisor.shutdownAll())
    );
  });

  function createSupervisor(
    internalCommandAllowlist?: UtilitySupervisorOptions["internalCommandAllowlist"],
    internalCommandAuthorize?: UtilitySupervisorOptions["internalCommandAuthorize"]
  ): UtilitySupervisor {
    const supervisor = new UtilitySupervisor({
      onUtilityEvent: vi.fn(),
      onUnexpectedExit: vi.fn(),
      onWorkerRestarted: vi.fn(),
      ...(internalCommandAllowlist ? { internalCommandAllowlist } : {}),
      ...(internalCommandAuthorize ? { internalCommandAuthorize } : {})
    });
    supervisors.push(supervisor);
    supervisor.startAll();
    return supervisor;
  }

  it("starts utility workers with the current process environment", () => {
    createSupervisor();
    expect(electronMocks.fork).toHaveBeenCalled();
    for (const [, , options] of electronMocks.fork.mock.calls) {
      expect(options.env).toEqual(expect.objectContaining(process.env));
    }
  });

  function dispatchInternalRequest(
    target: UtilityInternalCommandTarget,
    command: CommandEnvelope,
    requestId = `bridge_${command.id}`,
    timeoutMs = 1_000
  ): void {
    processes.get("agent")!.dispatch({
      kind: "utility.internal.command.request",
      worker: "agent",
      target,
      requestId,
      parentRequestId: "agent_prompt_transport",
      timeoutMs,
      command
    });
  }

  it("routes an allowlisted Agent request through Core and correlates its result", async () => {
    createSupervisor({ core: ["system.health"] });
    const command = createEnvelope(
      "system.health",
      {},
      { id: "internal_health" }
    );

    dispatchInternalRequest("core", command);

    const targetRequest = processes
      .get("core")!
      .posted.find(
        (message) =>
          (message as { kind?: string }).kind === "utility.command.request"
      ) as { requestId: string; command: CommandEnvelope } | undefined;
    expect(targetRequest?.command.id).toBe(command.id);

    processes.get("core")!.dispatch({
      kind: "utility.command.result",
      worker: "core",
      requestId: targetRequest!.requestId,
      result: {
        status: "accepted",
        requestId: command.id,
        payload: { status: "ok" }
      }
    });
    await flushMicrotasks();

    expect(processes.get("agent")!.posted).toContainEqual({
      kind: "utility.internal.command.result",
      worker: "agent",
      target: "core",
      requestId: `bridge_${command.id}`,
      parentRequestId: "agent_prompt_transport",
      result: {
        status: "accepted",
        requestId: command.id,
        payload: { status: "ok" }
      }
    });
  });

  it("denies dangerous commands by default without forwarding them", () => {
    const authorize = vi.fn(() => true);
    createSupervisor(undefined, authorize);
    const command = createEnvelope(
      "catalog.deleteProject",
      { domain: "book" as const, projectId: "book-dangerous" },
      { id: "internal_delete_project" }
    );

    dispatchInternalRequest("core", command);

    expect(
      processes
        .get("core")!
        .posted.some(
          (message) =>
            (message as { kind?: string }).kind === "utility.command.request"
        )
    ).toBe(false);
    expect(processes.get("agent")!.posted).toContainEqual(
      expect.objectContaining({
        kind: "utility.internal.command.result",
        requestId: `bridge_${command.id}`,
        result: expect.objectContaining({
          status: "rejected",
          requestId: command.id,
          error: expect.objectContaining({
            code: "utility.internal_command_not_allowed"
          })
        })
      })
    );
    expect(authorize).not.toHaveBeenCalled();
  });

  it("runs the dynamic authorizer after allowlist and rejects before forwarding", () => {
    const authorize = vi.fn(
      (): ReturnType<
        NonNullable<UtilitySupervisorOptions["internalCommandAuthorize"]>
      > => ({
        authorized: false,
        code: "main.run_not_accepted",
        message: "The run has not completed the Main acceptance chain."
      })
    );
    createSupervisor({ core: ["system.health"] }, authorize);
    const command = createEnvelope(
      "system.health",
      {},
      { id: "internal_dynamic_denial" }
    );

    dispatchInternalRequest("core", command);

    expect(authorize).toHaveBeenCalledWith({
      source: "agent",
      target: "core",
      message: expect.objectContaining({
        command,
        parentRequestId: "agent_prompt_transport"
      })
    });
    expect(
      processes
        .get("core")!
        .posted.some(
          (message) =>
            (message as { kind?: string }).kind === "utility.command.request"
        )
    ).toBe(false);
    expect(processes.get("agent")!.posted).toContainEqual(
      expect.objectContaining({
        kind: "utility.internal.command.result",
        requestId: `bridge_${command.id}`,
        result: {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "utility.internal_command_unauthorized",
            message: "The run has not completed the Main acceptance chain.",
            details: {
              authorizationCode: "main.run_not_accepted"
            }
          }
        }
      })
    );
  });

  it("rejects a target timeout and ignores a late result", async () => {
    createSupervisor({ tool: ["system.health"] });
    const command = createEnvelope(
      "system.health",
      {},
      { id: "internal_timeout" }
    );

    dispatchInternalRequest("tool", command, `bridge_${command.id}`, 5);
    const targetRequest = processes
      .get("tool")!
      .posted.find(
        (message) =>
          (message as { kind?: string }).kind === "utility.command.request"
      ) as { requestId: string } | undefined;
    await new Promise((resolve) => setTimeout(resolve, 15));
    await flushMicrotasks();

    const agentResultsBeforeLateMessage = processes
      .get("agent")!
      .posted.filter(
        (message) =>
          (message as { kind?: string }).kind ===
          "utility.internal.command.result"
      );
    expect(agentResultsBeforeLateMessage).toContainEqual(
      expect.objectContaining({
        requestId: `bridge_${command.id}`,
        result: expect.objectContaining({
          status: "rejected",
          error: expect.objectContaining({
            code: "utility.internal_command_timeout"
          })
        })
      })
    );

    processes.get("tool")!.dispatch({
      kind: "utility.command.result",
      worker: "tool",
      requestId: targetRequest!.requestId,
      result: {
        status: "accepted",
        requestId: command.id,
        payload: {}
      }
    });
    await flushMicrotasks();
    expect(
      processes
        .get("agent")!
        .posted.filter(
          (message) =>
            (message as { kind?: string }).kind ===
            "utility.internal.command.result"
        )
    ).toHaveLength(agentResultsBeforeLateMessage.length);
  });

  it("settles a pending bridge when its target exits", async () => {
    createSupervisor({ core: ["system.health"] });
    const command = createEnvelope(
      "system.health",
      {},
      { id: "internal_target_exit" }
    );

    dispatchInternalRequest("core", command);
    processes.get("core")!.exit(9);
    await flushMicrotasks();

    expect(processes.get("agent")!.posted).toContainEqual(
      expect.objectContaining({
        kind: "utility.internal.command.result",
        requestId: `bridge_${command.id}`,
        result: expect.objectContaining({
          status: "rejected",
          error: expect.objectContaining({
            code: "utility.internal_command_target_exited"
          })
        })
      })
    );
  });

  it("cancels bridges, stops Agent first, then stops Tool and Core", async () => {
    const supervisor = createSupervisor({ core: ["system.health"] });
    const command = createEnvelope(
      "system.health",
      {},
      { id: "internal_shutdown" }
    );
    dispatchInternalRequest("core", command);

    await supervisor.shutdownAll();

    expect(processes.get("agent")!.posted).toContainEqual(
      expect.objectContaining({
        kind: "utility.internal.command.result",
        requestId: `bridge_${command.id}`,
        result: expect.objectContaining({
          status: "rejected",
          error: expect.objectContaining({
            code: "utility.internal_command_cancelled"
          })
        })
      })
    );
    const agentShutdownIndex = activity.indexOf("agent:utility.shutdown");
    const toolShutdownIndex = activity.indexOf("tool:utility.shutdown");
    const coreShutdownIndex = activity.indexOf("core:utility.shutdown");
    expect(agentShutdownIndex).toBeGreaterThanOrEqual(0);
    expect(toolShutdownIndex).toBeGreaterThan(agentShutdownIndex);
    expect(coreShutdownIndex).toBeGreaterThan(agentShutdownIndex);
  });
});
