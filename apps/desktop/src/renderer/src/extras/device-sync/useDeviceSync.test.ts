import { useCatalogIndexStore } from "../../stores/catalogIndexStore";
import { createPinia, setActivePinia } from "pinia";
import { useLongWorkspaceStore } from "../../stores/longWorkspaceStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onMounted, ref } from "vue";
import type {
  SyncConfig,
  SyncItem,
  SyncRequest,
  SyncResponse,
  SyncStatus
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../../ui-feedback";
import { useDeviceSync } from "./useDeviceSync";
import { prepareDeviceSyncEditors } from "../../composables/deviceSyncEditorGate";

vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  onMounted: vi.fn(),
  onBeforeUnmount: vi.fn()
}));
vi.mock("../../ui-feedback", () => ({
  uiMessage: { error: vi.fn(), info: vi.fn(), success: vi.fn() }
}));

function config(): SyncConfig {
  return {
    schemaVersion: 1,
    provider: "webdav",
    endpoint: "https://example.test/dav/",
    username: "writer@example.test",
    directory: "DeepWriteSync",
    spaceId: null,
    deviceName: "测试电脑",
    excludedKeys: ["book:excluded"]
  };
}

// Fail on Vue proxies at the renderer boundary, before preload validation runs.
const bridgeRequest = vi.fn(
  async (input: SyncRequest): Promise<SyncResponse> => {
    structuredClone(input);
    return input.operation === "connect"
      ? { kind: "spaces", spaces: [] }
      : { kind: "cancelled" };
  }
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    deepwrite: { deviceSync: { request: bridgeRequest } }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("device sync renderer bridge", () => {
  function initialStatus(): SyncStatus {
    return {
      config: config(),
      credentialSaved: true,
      deviceId: "test-device",
      firstSyncConfirmed: false,
      lastSuccessAt: null,
      lastCheckedAt: null,
      progress: { phase: "idle", completed: 0, total: 0, title: "" },
      items: [],
      issues: [],
      devices: [],
      history: []
    };
  }

  it("drops the old active long-book cache before reloading the initialized catalog", async () => {
    setActivePinia(createPinia());
    const store = useLongWorkspaceStore();
    const clearCatalog = vi.spyOn(useCatalogIndexStore(), "clear");
    store.activateBook("longbook_old");
    const response: SyncResponse = {
      kind: "status",
      status: {
        ...initialStatus(),
        progress: {
          phase: "complete",
          title: "本机已初始化",
          completed: 1,
          total: 1
        }
      }
    };
    bridgeRequest.mockResolvedValueOnce(response);
    const changed = vi.fn(async () => {
      expect(store.activeBookId).toBeNull();
    });
    const sync = useDeviceSync(changed, async () => true);
    await sync.run({ operation: "initialize", token: "preview_test" });
    expect(changed).toHaveBeenCalledOnce();
    expect(store.activeBookId).toBeNull();
    expect(clearCatalog).toHaveBeenCalledOnce();
  });

  it.each(["preview-initialization", "initialize"] as const)(
    "saves before %s and refreshes only after replacement",
    async (operation) => {
      const prepare = vi.fn(async () => true);
      const changed = vi.fn(async () => undefined);
      const sync = useDeviceSync(changed, prepare);
      const input: SyncRequest =
        operation === "initialize"
          ? { operation, token: "preview_test" }
          : { operation, deviceId: "phone_test" };
      await sync.run(input);
      expect(prepare).toHaveBeenCalledOnce();
      expect(bridgeRequest).toHaveBeenCalledWith(input);
      expect(changed).toHaveBeenCalledTimes(operation === "initialize" ? 1 : 0);
    }
  );

  it.each(["preview-initialization", "initialize"] as const)(
    "does not send %s while drafts cannot be saved",
    async (operation) => {
      const prepare = vi.fn(async () => false);
      const changed = vi.fn(async () => undefined);
      const sync = useDeviceSync(changed, prepare);
      await sync.run(
        operation === "initialize"
          ? { operation, token: "preview_test" }
          : { operation, deviceId: "phone_test" }
      );
      expect(
        bridgeRequest.mock.calls.some(
          ([input]) => input.operation === operation
        )
      ).toBe(false);
      expect(changed).not.toHaveBeenCalled();
    }
  );

  it("previews first sync without saving or reloading local drafts", async () => {
    const prepare = vi.fn(async () => false);
    const changed = vi.fn(async () => undefined);
    const sync = useDeviceSync(changed, prepare);
    sync.status.value = initialStatus();

    await sync.run({ operation: "sync", confirmFirst: false });

    expect(bridgeRequest).toHaveBeenCalledWith({
      operation: "sync",
      confirmFirst: false
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(uiMessage.info).not.toHaveBeenCalled();
  });

  it.each([false, true, null])(
    "still blocks actual sync when saving fails (confirmed status: %s)",
    async (confirmed) => {
      const prepare = vi.fn(async () => false);
      const changed = vi.fn(async () => undefined);
      const sync = useDeviceSync(changed, prepare);
      if (confirmed !== null)
        sync.status.value = {
          ...initialStatus(),
          firstSyncConfirmed: confirmed
        };

      await sync.run({ operation: "sync", confirmFirst: confirmed === false });

      expect(prepare).toHaveBeenCalledOnce();
      expect(
        bridgeRequest.mock.calls.some(([input]) => input.operation === "sync")
      ).toBe(false);
      expect(changed).not.toHaveBeenCalled();
      expect(uiMessage.info).toHaveBeenCalledWith(
        "请先保存正文并处理保存冲突。"
      );
    }
  );

  it("allows remote initialization with an orphaned recovery draft in an empty workspace", async () => {
    const save = vi.fn();
    const changed = vi.fn(async () => undefined);
    const drafts = ref({
      "missing-document": {
        title: "旧草稿",
        content: "待恢复正文",
        dirty: true
      }
    });
    const before = { ...drafts.value["missing-document"] };
    const sync = useDeviceSync(changed, () =>
      prepareDeviceSyncEditors({
        documents: ref([]),
        drafts,
        drain: async () => undefined,
        save,
        saveLong: async () => true
      })
    );
    sync.status.value = initialStatus();

    await sync.run({ operation: "sync", confirmFirst: true });

    expect(bridgeRequest).toHaveBeenCalledWith({
      operation: "sync",
      confirmFirst: true
    });
    expect(save).not.toHaveBeenCalled();
    expect(drafts.value["missing-document"]).toEqual(before);
    expect(changed).toHaveBeenCalledOnce();
    expect(uiMessage.info).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "connects with a shallow-copied reactive form (excluded items: %s)",
    async (hasExcluded) => {
      const form = ref(config());
      if (!hasExcluded) form.value.excludedKeys = [];
      const input: SyncRequest = {
        operation: "connect",
        config: { ...form.value },
        password: "invalid-test-password"
      };
      expect(() => structuredClone(input)).toThrow();
      const sync = useDeviceSync(
        vi.fn(),
        vi.fn(async () => true)
      );

      await expect(sync.run(input)).resolves.toEqual({
        kind: "spaces",
        spaces: []
      });

      const sent = bridgeRequest.mock.calls[0]![0];
      expect(sent).toEqual(input);
      form.value.excludedKeys.push("book:later-edit");
      expect(sent.operation === "connect" && sent.config.excludedKeys).toEqual(
        hasExcluded ? ["book:excluded"] : []
      );
      expect(uiMessage.error).not.toHaveBeenCalled();
      expect(sync.pending.value).toBe(false);
    }
  );

  it("sends a detached snapshot when configuring reactive sync settings", async () => {
    const form = ref(config());
    const sync = useDeviceSync(
      vi.fn(),
      vi.fn(async () => true)
    );
    await sync.request({ operation: "configure", config: form.value });

    const sent = bridgeRequest.mock.calls[0]![0];
    expect(sent).toEqual({ operation: "configure", config: form.value });
    form.value.deviceName = "编辑后的名称";
    form.value.excludedKeys.push("book:later-edit");
    expect(sent).toEqual({ operation: "configure", config: config() });
  });

  it("sends reactive conflict versions with nested files through the bridge", async () => {
    const version = ref<SyncItem>({
      kind: "book",
      id: "sample-book",
      title: "测试作品",
      files: { "draft.md": "选择的正文\n第二段" }
    });
    const input: SyncRequest = {
      operation: "sync",
      resolutions: [{ token: "invalid-test-resolution", item: version.value }],
      confirmFirst: true
    };
    expect(() => structuredClone(input)).toThrow();
    const changed = vi.fn(async () => undefined);
    const prepare = vi.fn(async () => true);
    const sync = useDeviceSync(changed, prepare);

    await expect(sync.run(input)).resolves.toEqual({ kind: "cancelled" });

    const sent = bridgeRequest.mock.calls[0]![0];
    expect(sent).toEqual(input);
    version.value.files["draft.md"] = "后续编辑";
    expect(
      sent.operation === "sync" &&
        sent.resolutions?.[0]?.item?.files["draft.md"]
    ).toBe("选择的正文\n第二段");
    expect(prepare).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
    expect(uiMessage.error).not.toHaveBeenCalled();
  });

  it.each(["remote", "local"] as const)(
    "saves drafts, detaches the selected keys, and refreshes after adopting %s",
    async (side) => {
      const keys = ref(["book:example", "book:second"]);
      const prepare = vi.fn(async () => true);
      const changed = vi.fn(async () => undefined);
      const sync = useDeviceSync(changed, prepare);
      sync.status.value = { ...initialStatus(), firstSyncConfirmed: true };

      await sync.run({
        operation: "sync",
        adoption: { side, keys: keys.value }
      });

      const sent = bridgeRequest.mock.calls.find(
        ([input]) => input.operation === "sync"
      )?.[0];
      keys.value.push("book:later");
      expect(sent).toEqual({
        operation: "sync",
        adoption: { side, keys: ["book:example", "book:second"] }
      });
      expect(prepare).toHaveBeenCalledOnce();
      expect(changed).toHaveBeenCalledOnce();
      expect(uiMessage.error).not.toHaveBeenCalled();
      expect(sync.pending.value).toBe(false);
    }
  );

  it("does not adopt a version when current drafts cannot be saved", async () => {
    const changed = vi.fn(async () => undefined);
    const sync = useDeviceSync(
      changed,
      vi.fn(async () => false)
    );
    sync.status.value = { ...initialStatus(), firstSyncConfirmed: true };
    await sync.run({
      operation: "sync",
      adoption: { side: "remote", keys: ["book:example"] }
    });
    expect(
      bridgeRequest.mock.calls.some(([input]) => input.operation === "sync")
    ).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it("rejects invalid form values before crossing the bridge without exposing them", async () => {
    const sync = useDeviceSync(
      vi.fn(),
      vi.fn(async () => true)
    );
    await expect(
      sync.request({
        operation: "connect",
        config: { ...config(), endpoint: "invalid-test-endpoint" },
        password: "invalid-test-password"
      })
    ).rejects.toThrow("请填写有效的 HTTPS 地址、账号和同步目录。");
    expect(bridgeRequest).not.toHaveBeenCalled();
  });

  it("records initialization failure and clears it when retrying with ignoreOtherDevices", async () => {
    const sync = useDeviceSync(
      vi.fn(async () => undefined),
      vi.fn(async () => true)
    );
    const reason =
      "远端设备（旧手机）还有未合并的版本，请先在电脑端完成同步后重试，或选择忽略其他设备继续初始化。";
    bridgeRequest.mockRejectedValueOnce(new Error(reason));
    await expect(
      sync.run({ operation: "preview-initialization", deviceId: "pc_test" })
    ).resolves.toBeNull();
    expect(sync.initError.value).toBe(reason);
    expect(uiMessage.error).toHaveBeenCalledWith(reason);

    const previewResponse: SyncResponse = {
      kind: "initialization-preview",
      preview: {
        token: "preview_token",
        deviceId: "pc_test",
        deviceName: "我的电脑",
        remoteUpdatedAt: "2026-09-08T01:00:00.000Z",
        remoteHash: "a".repeat(64),
        itemCount: 2,
        fileCount: 4,
        localItemCount: 1,
        expiresAt: "2026-09-08T01:10:00.000Z",
        ignoredDevices: ["旧手机"]
      }
    };
    bridgeRequest.mockResolvedValueOnce(previewResponse);
    await expect(
      sync.run({
        operation: "preview-initialization",
        deviceId: "pc_test",
        ignoreOtherDevices: true
      })
    ).resolves.toEqual(previewResponse);
    expect(sync.initError.value).toBeNull();
    expect(bridgeRequest).toHaveBeenCalledWith({
      operation: "preview-initialization",
      deviceId: "pc_test",
      ignoreOtherDevices: true
    });
  });
});

describe("device sync status refresh and scope", () => {
  const status = (): SyncStatus => ({
    config: { ...config(), spaceId: "space_test" },
    credentialSaved: true,
    deviceId: "test-device",
    firstSyncConfirmed: true,
    lastSuccessAt: null,
    lastCheckedAt: null,
    progress: { phase: "idle", completed: 0, total: 0, title: "" },
    items: [
      {
        key: "book:a",
        title: "测试作品",
        kind: "book",
        included: true,
        dirty: true,
        remoteDirty: false
      }
    ],
    issues: [],
    devices: [],
    history: []
  });
  function deferred() {
    let resolve!: (value: SyncResponse) => void;
    const promise = new Promise<SyncResponse>((done) => (resolve = done));
    return { promise, resolve };
  }
  const calls = (operation: SyncRequest["operation"]) =>
    bridgeRequest.mock.calls.filter(([input]) => input.operation === operation)
      .length;
  const original = bridgeRequest.getMockImplementation()!;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    bridgeRequest.mockImplementation(original);
    vi.useRealTimers();
  });

  it("polls only while an operation reports progress, one read at a time", async () => {
    const sync = useDeviceSync(
      vi.fn(async () => undefined),
      vi.fn(async () => true)
    );
    vi.mocked(onMounted).mock.calls.at(-1)![0]();
    await vi.advanceTimersByTimeAsync(0);
    sync.status.value = status();
    const restoring = deferred();
    const syncing = deferred();
    const polled = deferred();
    bridgeRequest.mockImplementation(async (input) =>
      input.operation === "restore"
        ? restoring.promise
        : input.operation === "sync"
          ? syncing.promise
          : input.operation === "status"
            ? polled.promise
            : { kind: "cancelled" }
    );

    const restore = sync.run({ operation: "restore", historyId: "history_1" });
    await vi.advanceTimersByTimeAsync(4500);
    expect(calls("status")).toBe(1);
    restoring.resolve({ kind: "cancelled" });
    await restore;
    const before = calls("status");

    const run = sync.run({ operation: "sync", confirmFirst: true });
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls("status")).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(4500);
    expect(calls("status")).toBe(before + 1);
    polled.resolve({ kind: "status", status: status() });
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls("status")).toBe(before + 2);
    syncing.resolve({ kind: "status", status: status() });
    await run;
  });

  it("saves the scope just chosen before a sync starts, without blocking the page", async () => {
    const sync = useDeviceSync(
      vi.fn(async () => undefined),
      vi.fn(async () => true)
    );
    sync.status.value = status();
    sync.scope.toggle(["book:a"], false);
    expect(sync.pending.value).toBe(false);
    expect(sync.scope.items.value[0]?.included).toBe(false);

    await sync.run({ operation: "sync" });

    const operations = bridgeRequest.mock.calls.map(
      ([input]) => input.operation
    );
    expect(operations.slice(0, 2)).toEqual(["configure", "sync"]);
    const sent = bridgeRequest.mock.calls[0]![0];
    expect(sent.operation === "configure" && sent.config.excludedKeys).toEqual([
      "book:excluded",
      "book:a"
    ]);
  });

  it("does not sync when Main rejects the new scope", async () => {
    const sync = useDeviceSync(
      vi.fn(async () => undefined),
      vi.fn(async () => true)
    );
    sync.status.value = status();
    bridgeRequest.mockRejectedValueOnce(new Error("同步正在进行，请稍候。"));
    sync.scope.toggle(["book:a"], false);

    await expect(sync.run({ operation: "sync" })).resolves.toBeNull();

    expect(calls("sync")).toBe(0);
    expect(uiMessage.error).toHaveBeenCalledWith(
      "同步范围未能保存，已恢复为之前的设置。同步正在进行，请稍候。"
    );
    expect(sync.scope.items.value[0]?.included).toBe(true);
    expect(sync.pending.value).toBe(false);
  });
});
