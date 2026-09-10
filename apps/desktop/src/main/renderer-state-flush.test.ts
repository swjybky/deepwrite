import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";
import { createRendererStateFlushCoordinator } from "./renderer-state-flush";
import { guardConversationWindowClose } from "./conversation-window-close";
import { createGracefulShutdown } from "./graceful-shutdown";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("conversation flush before close", () => {
  it("waits for late readiness instead of treating an unregistered renderer as saved", async () => {
    const coordinator = createRendererStateFlushCoordinator();
    const window = {
      isDestroyed: () => false,
      webContents: { id: 9, send: vi.fn() }
    };
    let saved = false;
    const waiting = coordinator.request(window).then(() => {
      saved = true;
    });
    await Promise.resolve();
    expect(saved).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalled();
    coordinator.handleCommand(
      9,
      createEnvelope(
        "rendererState.flushReady",
        { enabled: true },
        { id: "ready-late" }
      )
    );
    const request = window.webContents.send.mock.calls[0]![1] as { id: string };
    coordinator.handleCommand(
      9,
      createEnvelope(
        "rendererState.flushCompleted",
        {
          requestId: request.id,
          ok: true
        },
        { id: "saved-late" }
      )
    );
    await waiting;
    expect(saved).toBe(true);
  });

  it("cancels exit when readiness never arrives", async () => {
    vi.useFakeTimers();
    const coordinator = createRendererStateFlushCoordinator(1_000);
    const waiting = expect(
      coordinator.request({
        isDestroyed: () => false,
        webContents: { id: 10, send: vi.fn() }
      })
    ).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(1_000);
    await waiting;
  });

  it("waits for the matching renderer acknowledgement and deduplicates close requests", async () => {
    const coordinator = createRendererStateFlushCoordinator();
    const window = {
      isDestroyed: () => false,
      webContents: { id: 7, send: vi.fn() }
    };
    coordinator.handleCommand(
      7,
      createEnvelope(
        "rendererState.flushReady",
        { enabled: true },
        { id: "ready", correlationId: "ready" }
      )
    );
    const waiting = coordinator.request(window);
    expect(coordinator.request(window)).toBe(waiting);
    const request = window.webContents.send.mock.calls[0]![1] as { id: string };
    let saved = false;
    void waiting.then(() => {
      saved = true;
    });
    const completion = createEnvelope(
      "rendererState.flushCompleted",
      { requestId: request.id, ok: true },
      { id: "done", correlationId: "done" }
    );
    coordinator.handleCommand(8, completion);
    await Promise.resolve();
    expect(saved).toBe(false);
    coordinator.handleCommand(7, completion);
    await waiting;
    expect(saved).toBe(true);
  });

  it("rejects a failed save or timeout instead of authorizing a destructive close", async () => {
    vi.useFakeTimers();
    const coordinator = createRendererStateFlushCoordinator(1_000);
    const window = {
      isDestroyed: () => false,
      webContents: { id: 7, send: vi.fn() }
    };
    coordinator.handleCommand(
      7,
      createEnvelope(
        "rendererState.flushReady",
        { enabled: true },
        { id: "ready", correlationId: "ready" }
      )
    );
    const failure = expect(coordinator.request(window)).rejects.toThrow(
      "尚未保存"
    );
    const request = window.webContents.send.mock.calls[0]![1] as { id: string };
    coordinator.handleCommand(
      7,
      createEnvelope(
        "rendererState.flushCompleted",
        { requestId: request.id, ok: false },
        { id: "failed", correlationId: "failed" }
      )
    );
    await failure;
    const timeout = expect(coordinator.request(window)).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(1_000);
    await timeout;
  });

  it("lets a window close only after its final write and permits retry after failure", async () => {
    let listener!: (event: { preventDefault(): void }) => void;
    const window = {
      isDestroyed: () => false,
      close: vi.fn(),
      on(_event: "close", handler: typeof listener) {
        listener = handler;
      }
    };
    const first = deferred();
    const second = deferred();
    const flush = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onError = vi.fn();
    guardConversationWindowClose(window, { skip: () => false, flush, onError });
    const event = { preventDefault: vi.fn() };
    listener(event);
    listener(event);
    await Promise.resolve();
    expect(flush).toHaveBeenCalledOnce();
    expect(window.close).not.toHaveBeenCalled();
    first.reject(new Error("模拟磁盘失败"));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    listener(event);
    await Promise.resolve();
    second.resolve();
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce());
  });

  it("keeps Core alive past the old fixed shutdown delay until the renderer finishes", async () => {
    vi.useFakeTimers();
    const write = deferred();
    const shutdownUtilities = vi.fn(async () => undefined);
    const complete = vi.fn();
    const coordinator = createGracefulShutdown({
      flushRenderer: () => write.promise,
      shutdownUtilities,
      flushUsage: async () => undefined,
      reportUsage: async () => undefined,
      complete,
      cancel: vi.fn()
    });
    coordinator.begin();
    coordinator.begin({ installUpdate: true });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(shutdownUtilities).not.toHaveBeenCalled();
    write.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(shutdownUtilities).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(true);
  });
});
