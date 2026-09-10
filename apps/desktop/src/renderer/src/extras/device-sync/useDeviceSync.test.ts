import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type {
  SyncConfig,
  SyncItem,
  SyncRequest,
  SyncResponse
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../../ui-feedback";
import { useDeviceSync } from "./useDeviceSync";

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
