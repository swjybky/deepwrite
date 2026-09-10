import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  syncRequestSchema,
  type SyncRequest,
  type SyncResponse,
  type SyncStatus
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../../ui-feedback";

export function useDeviceSync(
  changed: () => Promise<void>,
  prepareSync: () => Promise<boolean>
) {
  const status = ref<SyncStatus | null>(null);
  const pending = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let epoch = 0;
  const request = async (input: SyncRequest): Promise<SyncResponse> => {
    const started = epoch;
    const api = window.deepwrite?.deviceSync;
    if (!api) throw new Error("请在支持双端同步的桌面客户端中打开。");
    // Clone nested reactive values before contextBridge copies the arguments.
    // Preload validation runs too late to remove proxies from this boundary.
    const parsed = syncRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new Error("请填写有效的 HTTPS 地址、账号和同步目录。");
    const result = await api.request(parsed.data);
    if (!disposed && started === epoch && result.kind === "status")
      status.value = result.status;
    return result;
  };
  const run = async (input: SyncRequest): Promise<SyncResponse | null> => {
    if (pending.value && input.operation !== "cancel") return null;
    const mutation = input.operation !== "cancel";
    if (mutation) {
      epoch++;
      pending.value = true;
    }
    try {
      if (
        ["sync", "restore"].includes(input.operation) &&
        !(await prepareSync())
      ) {
        uiMessage.info("请先保存正文并处理保存冲突。");
        return null;
      }
      const response = await request(input);
      if (["sync", "restore"].includes(input.operation)) await changed();
      if (input.operation === "restore")
        uiMessage.success("已恢复到本机，下次手动同步时上传。");
      if (input.operation === "sync" && response.kind === "status") {
        if (response.status.progress.phase === "complete")
          uiMessage.success(response.status.progress.title);
        else if (response.status.progress.phase === "partial")
          uiMessage.info(response.status.progress.title);
      }
      return response;
    } catch (error) {
      uiMessage.error(
        error instanceof Error ? error.message : "同步未完成，请重试。"
      );
      return null;
    } finally {
      if (mutation) {
        epoch++;
        pending.value = false;
      }
      if (!disposed)
        void request({ operation: "status" }).catch(() => {
          /* Preserve the last known state after a failed refresh. */
        });
    }
  };
  onMounted(() => {
    void request({ operation: "status" })
      .then((result) => {
        if (
          !disposed &&
          result.kind === "status" &&
          result.status.config?.spaceId
        )
          return run({ operation: "check" });
      })
      .catch((error: unknown) =>
        uiMessage.error(
          error instanceof Error ? error.message : "读取同步状态失败。"
        )
      );
    timer = setInterval(() => {
      if (pending.value)
        void request({ operation: "status" }).catch(() => {
          /* The active request reports its own error. */
        });
    }, 1500);
  });
  onBeforeUnmount(() => {
    disposed = true;
    if (timer) clearInterval(timer);
  });
  return { status, pending, run, request };
}
