import { computed, ref } from "vue";
import type { DeepWriteApi } from "@deepwrite/contracts";
import { isDeepWriteSiteOfficialModel } from "@deepwrite/contracts/renderer";
import type { useSettingsStore } from "../stores/settingsStore";
import { beginSiteOfficialQuotaRequest } from "./siteOfficialQuotaRequests";

interface QuotaMergeContext {
  api(): DeepWriteApi | undefined;
  settingsStore: ReturnType<typeof useSettingsStore>;
  notifications: {
    warning(message: string): void;
    error(message: string): void;
    success(message: string): void;
  };
}

export function useSiteOfficialQuotaMerge(context: QuotaMergeContext) {
  const { settingsStore: store, notifications } = context;
  const open = ref(false);
  const sourceKey = ref("");
  const pending = ref(false);
  let targetRevision = "";
  const disabledReason = computed(() => {
    if (store.siteOfficialModelsSaving || store.siteOfficialModelsRefreshing) {
      return "请等待当前操作完成。";
    }
    if (
      !store.modelSettings?.models.some(
        (model) => isDeepWriteSiteOfficialModel(model) && model.hasApiKey
      )
    ) {
      return "请先添加当前密钥。";
    }
    if (store.siteOfficialQuota?.unlimited) return "无限额度密钥无需增加额度。";
    if (!store.siteOfficialQuota?.targetRevision)
      return "请先刷新当前密钥额度。";
    return "";
  });

  function show(): void {
    if (disabledReason.value || pending.value) return;
    targetRevision = store.siteOfficialQuota!.targetRevision!;
    sourceKey.value = "";
    open.value = true;
  }

  function close(): void {
    if (pending.value) return;
    sourceKey.value = "";
    targetRevision = "";
    open.value = false;
  }

  async function submit(): Promise<void> {
    if (pending.value || !open.value) return;
    const source = sourceKey.value.trim();
    if (!source || source.length > 1_024) {
      notifications.warning("请输入有效的来源 Key。");
      return;
    }
    if (
      disabledReason.value ||
      store.siteOfficialQuota?.targetRevision !== targetRevision
    ) {
      notifications.warning(
        disabledReason.value || "当前密钥配置已变化，请刷新额度后重新确认。"
      );
      close();
      return;
    }
    const api = context.api();
    if (!api) {
      notifications.error("桌面服务暂不可用，请稍后重试。");
      return;
    }
    pending.value = true;
    store.siteOfficialModelsSaving = true;
    const current = beginSiteOfficialQuotaRequest(store);
    try {
      const result = await api.models.mergeSiteOfficialQuota({
        sourceKey: source,
        targetRevision
      });
      sourceKey.value = "";
      open.value = false;
      targetRevision = "";
      if (current()) store.siteOfficialQuota = result.quota;
      notifications.success(
        `已转入 ¥${result.transferred}，来源 Key 已永久注销。`
      );
      try {
        const quota = await api.models.querySiteOfficialQuota();
        if (current()) store.siteOfficialQuota = quota;
      } catch {
        // The merge result already contains the authoritative post-merge quota.
        notifications.warning("额度已转入，暂未刷新最新用量，请稍后刷新页面。");
      }
    } catch (error: unknown) {
      notifications.error(
        error instanceof Error
          ? error.message
          : "额度转入失败，请刷新额度确认结果后再试。"
      );
    } finally {
      sourceKey.value = "";
      pending.value = false;
      store.siteOfficialModelsSaving = false;
    }
  }

  return { open, sourceKey, pending, disabledReason, show, close, submit };
}
