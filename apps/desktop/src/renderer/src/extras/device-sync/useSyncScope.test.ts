import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type {
  SyncConfig,
  SyncResponse,
  SyncStatus
} from "@deepwrite/contracts/renderer";
import { SYNC_SCOPE_SAVE_DELAY_MS, useSyncScope } from "./useSyncScope";

function config(excludedKeys: string[] = []): SyncConfig {
  return {
    schemaVersion: 1,
    provider: "webdav",
    endpoint: "https://example.test/dav/",
    username: "writer@example.test",
    directory: "DeepWriteSync",
    spaceId: "space_test",
    deviceName: "测试电脑",
    excludedKeys
  };
}
function status(excludedKeys: string[] = []): SyncStatus {
  return {
    config: config(excludedKeys),
    credentialSaved: true,
    deviceId: "test-device",
    firstSyncConfirmed: true,
    lastSuccessAt: null,
    lastCheckedAt: null,
    progress: { phase: "idle", completed: 0, total: 0, title: "" },
    items: ["book:a", "book:b"].map((key) => ({
      key,
      title: key,
      kind: "book" as const,
      included: !excludedKeys.includes(key),
      dirty: false,
      remoteDirty: false
    })),
    issues: [],
    devices: [],
    history: []
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const included = (scope: ReturnType<typeof useSyncScope>) =>
  scope.items.value.map((item) => item.included);

function setup(idle: () => Promise<unknown> = () => Promise.resolve()) {
  const state = ref<SyncStatus | null>(status());
  const configure = vi.fn(async (next: SyncConfig): Promise<SyncResponse> => {
    state.value = status(next.excludedKeys);
    return { kind: "status", status: state.value };
  });
  const restore = vi.fn(async () => {
    state.value = status(state.value?.config?.excludedKeys);
  });
  const scope = useSyncScope({ status: state, idle, configure, restore });
  return { state, configure, restore, scope };
}
const wait = () => vi.advanceTimersByTimeAsync(SYNC_SCOPE_SAVE_DELAY_MS);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sync scope switches", () => {
  it("show every click at once and save them together", async () => {
    const { configure, scope } = setup();
    scope.toggle(["book:a"], false);
    scope.toggle(["book:b"], false);
    expect(included(scope)).toEqual([false, false]);
    expect(configure).not.toHaveBeenCalled();

    await wait();
    expect(configure).toHaveBeenCalledOnce();
    expect(configure.mock.calls[0]![0].excludedKeys).toEqual([
      "book:a",
      "book:b"
    ]);
    expect(included(scope)).toEqual([false, false]);
  });

  it("send nothing when a switch ends where it started", async () => {
    const { configure, scope } = setup();
    scope.toggle(["book:a"], false);
    scope.toggle(["book:a"], true);
    await wait();
    expect(configure).not.toHaveBeenCalled();
    expect(included(scope)).toEqual([true, true]);
  });

  it("wait for the running operation before saving", async () => {
    const running = deferred<void>();
    const { configure, scope } = setup(() => running.promise);
    scope.toggle(["book:a"], false);
    await wait();
    expect(configure).not.toHaveBeenCalled();
    expect(included(scope)).toEqual([false, true]);
    running.resolve();
    await vi.waitFor(() => expect(configure).toHaveBeenCalledOnce());
  });

  it("return to Main's state when the save is rejected", async () => {
    const { configure, restore, scope } = setup();
    const error = new Error("同步正在进行，请稍候。");
    configure.mockRejectedValueOnce(error);
    scope.toggle(["book:a"], false);
    expect(await scope.flush()).toBe(false);
    expect(restore).toHaveBeenCalledWith(error);
    expect(included(scope)).toEqual([true, true]);
  });

  it("keep a click made during a save and save it next", async () => {
    const { state, configure, scope } = setup();
    const answer = deferred<SyncResponse>();
    configure.mockImplementationOnce(async (next) => {
      const response = await answer.promise;
      state.value = status(next.excludedKeys);
      return response;
    });
    scope.toggle(["book:a"], false);
    await wait();
    scope.toggle(["book:a"], true);
    answer.resolve({ kind: "cancelled" });
    await vi.waitFor(() =>
      expect(state.value?.config?.excludedKeys).toEqual(["book:a"])
    );
    expect(included(scope)).toEqual([true, true]);

    await wait();
    expect(configure).toHaveBeenCalledTimes(2);
    expect(configure.mock.calls[1]![0].excludedKeys).toEqual([]);
  });

  it("save right away when the page closes", async () => {
    const { configure, scope } = setup();
    scope.toggle(["book:b"], false);
    scope.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(configure).toHaveBeenCalledOnce();
  });
});
