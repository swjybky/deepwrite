import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConversationStore } from "./conversationStore";
import { conversationHistoryPersistenceKey } from "../utils/conversationPersistenceKeys";
import {
  createDeferredApi,
  createEnvelope,
  document,
  runtime,
  useAgentConversation
} from "../composables/useAgentConversation.test-support";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settleCheckpoint() {
  await nextTick();
  for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
}

function harness() {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  const store = useConversationStore();
  const disk = new Map<string, unknown>();
  const key = conversationHistoryPersistenceKey("book:interruption");
  let close!: () => Promise<void>;
  const save = vi.fn(async (key: string, value: unknown) => {
    disk.set(key, structuredClone(value));
  });
  store.configurePersistenceAdapter({
    onBeforeClose(handler) {
      close = handler;
      return () => undefined;
    },
    load: async (key) => disk.get(key),
    save
  });
  const deferred = createDeferredApi();
  const controller = useAgentConversation({
    api: () => deferred.api,
    onPersistenceChange: () =>
      store.schedulePersistenceFactory(
        key,
        controller.capturePersistenceSnapshot
      )
  });
  store.registerController("book:interruption", "general", controller);
  return { store, controller, deferred, disk, key, save, close: () => close() };
}

async function startRun(h: ReturnType<typeof harness>) {
  h.controller.draft.value = "请完成这一轮写作";
  const sending = h.controller.sendMessage(document);
  h.deferred.resolveAccepted(0, {
    sessionId: h.controller.sessionId.value,
    runId: "run_interrupted",
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  await settleCheckpoint();
}

let eventClock = 0;
function delta(h: ReturnType<typeof harness>, content: string) {
  const sessionId = h.controller.sessionId.value;
  h.controller.handleEvent(
    createEnvelope(
      "agent.message_delta",
      {
        sessionId,
        runId: "run_interrupted",
        messageId: "message_interrupted",
        delta: content,
        runtime
      },
      {
        id: `delta_${++eventClock}`,
        context: { sessionId, runId: "run_interrupted" }
      }
    )
  );
}

function reopen(h: ReturnType<typeof harness>) {
  return useAgentConversation({
    api: () => undefined,
    initialPersistenceSnapshot: h.disk.get(h.key)
  });
}

describe("conversation persistence during interruption", () => {
  it("saves the new session and checkpoints continuous output without waiting for silence", async () => {
    const h = harness();
    h.controller.draft.value = "旧会话";
    await h.store.flushPersistence();
    await h.controller.newConversation();
    await startRun(h);
    const sessionId = h.controller.sessionId.value;
    const restored = reopen(h);
    expect(restored.sessionId.value).toBe(sessionId);
    expect(
      restored.messages.value.some((m) => m.content === "请完成这一轮写作")
    ).toBe(true);
    expect(restored.history.value).toHaveLength(2);
    restored.dispose();

    delta(h, "第一段");
    await vi.advanceTimersByTimeAsync(300);
    await settleCheckpoint();
    await h.store.flushPersistence();
    const writes = h.save.mock.calls.length;
    for (let index = 0; index < 30; index += 1) {
      delta(h, "后续段落");
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(h.save.mock.calls.length).toBeGreaterThan(writes);
    const interrupted = reopen(h);
    expect(interrupted.messages.value.at(-1)?.content).toContain("后续段落");
    interrupted.dispose();
    await h.store.dispose({ flush: false });
  });

  it("flushes the partial reply when the agent fails, even if the app immediately loses its renderer", async () => {
    const h = harness();
    await startRun(h);
    delta(h, "失败前已经生成的内容");
    const sessionId = h.controller.sessionId.value;
    h.controller.handleEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId,
          runId: "run_interrupted",
          code: "provider.failed",
          message: "模拟请求失败",
          retryable: false
        },
        { id: "event_failed", context: { sessionId, runId: "run_interrupted" } }
      )
    );
    await settleCheckpoint();
    await h.store.dispose({ flush: false });
    const restored = reopen(h);
    expect(restored.sessionId.value).toBe(sessionId);
    expect(
      restored.messages.value.some((m) =>
        m.content.includes("失败前已经生成的内容")
      )
    ).toBe(true);
    expect(restored.messages.value.at(-1)?.status).toBe("error");
    restored.dispose();
  });

  it("waits for the final queued write before acknowledging a normal close", async () => {
    const h = harness();
    await startRun(h);
    delta(h, "正常关闭前的内容");
    await vi.advanceTimersByTimeAsync(300);
    delta(h, "最后一段待保存内容");
    let finish!: () => void;
    h.save.mockImplementationOnce(async (key, value) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      h.disk.set(key, structuredClone(value));
    });
    let closed = false;
    const closing = h.close().then(() => {
      closed = true;
    });
    await settleCheckpoint();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(closed).toBe(false);
    finish();
    await closing;
    const restored = reopen(h);
    expect(
      restored.messages.value.some((m) =>
        m.content.includes("正常关闭前的内容")
      )
    ).toBe(true);
    expect(restored.messages.value.at(-1)?.status).toBe("stopped");
    restored.dispose();
    await h.store.dispose({ flush: false });
  });

  it("keeps failed writes for a later close retry without requiring a new message", async () => {
    const h = harness();
    h.controller.draft.value = "必须保留的草稿";
    h.save.mockRejectedValueOnce(new Error("模拟磁盘暂时不可写"));
    await expect(h.close()).rejects.toThrow("模拟磁盘暂时不可写");
    await expect(h.close()).resolves.toBeUndefined();
    const restored = reopen(h);
    expect(restored.draft.value).toBe("必须保留的草稿");
    restored.dispose();
    await h.store.dispose({ flush: false });
  });

  it("includes deltas still waiting for the next animation frame when closing", async () => {
    const h = harness();
    await startRun(h);
    await h.store.flushPersistence();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1)
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    delta(h, "尚未绘制的最后一段");
    expect(
      h.controller.messages.value.some((m) => m.content.includes("尚未绘制"))
    ).toBe(false);
    await h.close();
    const restored = reopen(h);
    expect(
      restored.messages.value.some((m) =>
        m.content.includes("尚未绘制的最后一段")
      )
    ).toBe(true);
    restored.dispose();
    await h.store.dispose({ flush: false });
  });

  it("loads the final pending snapshot when a conversation is immediately closed and reopened", async () => {
    const h = harness();
    await startRun(h);
    delta(h, "关闭前已经保存的内容");
    await h.store.flushPersistence();
    delta(h, "尚在队列中的最新内容");
    h.store.removeController("book:interruption");
    const restored = useAgentConversation({
      api: () => undefined,
      initialPersistenceSnapshot: await h.store.loadPersistence(h.key)
    });
    expect(
      restored.messages.value.some((message) =>
        message.content.includes("尚在队列中的最新内容")
      )
    ).toBe(true);
    restored.dispose();
    await h.store.dispose({ flush: false });
  });
});
