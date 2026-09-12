import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversationPersistenceState } from "./conversationPersistenceState";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}

afterEach(() => vi.useRealTimers());

describe("durable conversation save progress", () => {
  it("retains the failure until the retried value is acknowledged", async () => {
    const state = createConversationPersistenceState();
    const retry = deferred();
    let attempts = 0;
    state.configurePersistenceAdapter(
      {
        load: async () => undefined,
        save: async () => {
          if (++attempts === 1) throw new Error("测试磁盘不可写");
          await retry.promise;
        }
      },
      { debounceMs: 10_000 }
    );
    state.schedulePersistence("history", { revision: 1 });
    await expect(state.flushPersistence()).rejects.toThrow("测试磁盘不可写");
    expect(state.persistenceProgress.value.get("history")?.confirmed).toBe(0);
    state.schedulePersistence("history", { revision: 2 });
    expect(state.persistenceErrors.value.get("history")).toBe("测试磁盘不可写");
    const flushing = state.flushPersistence();
    await Promise.resolve();
    expect(state.persistenceErrors.value.has("history")).toBe(true);
    retry.resolve();
    await flushing;
    expect(state.persistenceErrors.value.has("history")).toBe(false);
    expect(state.persistenceProgress.value.get("history")).toEqual({
      status: "saved",
      requested: 2,
      confirmed: 2
    });
    state.disconnect();
  });

  it("retries an uncertain batch with the same identity before capturing its newer tail", async () => {
    const state = createConversationPersistenceState();
    state.configurePersistenceAdapter({
      load: async () => undefined,
      save: async () => undefined
    });
    const attempts: string[] = [];
    const confirmed: string[] = [];
    const firstReply = deferred();
    const secondReply = deferred();
    const captureFirst = vi.fn(() => ({
      retainOnFailure: true,
      async save() {
        attempts.push("batch-one");
        if (attempts.length === 1) await firstReply.promise;
      },
      confirmed() {
        confirmed.push("batch-one");
      }
    }));
    state.schedulePersistenceWork("history", captureFirst);
    const firstFlush = state.flushPersistence();
    await Promise.resolve();
    state.schedulePersistenceWork("history", () => ({
      async save() {
        attempts.push("batch-two");
        await secondReply.promise;
      },
      confirmed() {
        confirmed.push("batch-two");
      }
    }));
    firstReply.reject(new Error("测试确认中断"));
    await expect(firstFlush).rejects.toThrow("测试确认中断");
    expect(confirmed).toEqual([]);
    const retrying = state.flushPersistence();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(attempts).toEqual(["batch-one", "batch-one", "batch-two"]);
    expect(captureFirst).toHaveBeenCalledOnce();
    expect(state.persistenceProgress.value.get("history")?.confirmed).toBe(1);
    secondReply.resolve();
    await retrying;
    expect(confirmed).toEqual(["batch-one", "batch-two"]);
    expect(state.persistenceProgress.value.get("history")?.confirmed).toBe(2);
    state.disconnect();
  });

  it("does not postpone continuously changing history beyond the save window", async () => {
    vi.useFakeTimers();
    const state = createConversationPersistenceState();
    const save = vi.fn(async () => undefined);
    state.configurePersistenceAdapter({ load: async () => undefined, save });
    for (let revision = 1; revision <= 19; revision += 1) {
      state.schedulePersistence("history", { revision });
      await vi.advanceTimersByTimeAsync(100);
    }
    state.schedulePersistence("history", { revision: 20 });
    await vi.advanceTimersByTimeAsync(99);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("history", { revision: 20 });
    state.disconnect();
  });
});
