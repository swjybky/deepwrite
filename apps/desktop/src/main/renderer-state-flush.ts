import {
  createEnvelope,
  IPC_EVENT_CHANNEL,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";

interface FlushWindow {
  isDestroyed(): boolean;
  webContents: { id: number; send(channel: string, value: unknown): void };
}

interface PendingFlush {
  requestId: string;
  promise: Promise<void>;
  finish(error?: Error): void;
  send(): void;
}

/** Keeps Core alive until the renderer's serialized write queue is durable. */
export function createRendererStateFlushCoordinator(timeoutMs = 65_000) {
  const ready = new Set<number>();
  const pending = new Map<number, PendingFlush>();

  function reset(senderId: number): void {
    ready.delete(senderId);
    pending
      .get(senderId)
      ?.finish(new Error("会话保存期间窗口已关闭或重新加载。"));
  }

  function handleCommand(
    senderId: number,
    command: CommandEnvelope
  ): CommandResult | undefined {
    if (command.type === "rendererState.flushReady") {
      if (command.payload.enabled) {
        ready.add(senderId);
        pending.get(senderId)?.send();
      } else reset(senderId);
    } else if (command.type === "rendererState.flushCompleted") {
      const flush = pending.get(senderId);
      if (flush?.requestId === command.payload.requestId) {
        flush.finish(
          command.payload.ok
            ? undefined
            : new Error("对话尚未保存，已取消关闭窗口。")
        );
      }
    } else {
      return undefined;
    }
    return { status: "accepted", requestId: command.id, payload: { ok: true } };
  }

  function request(window: FlushWindow | undefined): Promise<void> {
    if (!window || window.isDestroyed()) return Promise.resolve();
    const senderId = window.webContents.id;
    const existing = pending.get(senderId);
    if (existing) return existing.promise;
    const requestId = createId("renderer_state_flush");
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(
      () => finish(new Error("等待对话保存超时，已取消关闭窗口。")),
      timeoutMs
    );
    function finish(error?: Error): void {
      if (pending.get(senderId)?.requestId !== requestId) return;
      clearTimeout(timer);
      pending.delete(senderId);
      if (error) reject(error);
      else resolve();
    }
    let sent = false;
    function send(): void {
      if (sent) return;
      sent = true;
      try {
        window!.webContents.send(
          IPC_EVENT_CHANNEL,
          createEnvelope(
            "rendererState.flushRequested",
            {},
            { id: requestId, correlationId: requestId }
          )
        );
      } catch {
        finish(new Error("无法请求保存窗口中的对话。"));
      }
    }
    pending.set(senderId, { requestId, promise, finish, send });
    // Missing readiness is not a successful save. Wait for registration or
    // cancel the exit on timeout instead of silently discarding the renderer.
    if (ready.has(senderId)) send();
    return promise;
  }

  return { request, handleCommand, reset };
}
