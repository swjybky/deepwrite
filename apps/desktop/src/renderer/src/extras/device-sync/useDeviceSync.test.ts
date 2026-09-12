import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
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
});
