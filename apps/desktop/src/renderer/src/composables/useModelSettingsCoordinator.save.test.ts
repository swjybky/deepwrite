import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepWriteApi } from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { useModelSettingsCoordinator } from "./useModelSettingsCoordinator";

beforeEach(() => setActivePinia(createPinia()));

describe("model configuration save failures", () => {
  it.each([
    [
      { code: "models.save_failed", message: "系统安全存储不可用。" },
      "系统安全存储不可用。"
    ],
    [undefined, "保存模型配置失败。"]
  ])(
    "shows the save cause and restores the save button",
    async (error, message) => {
      const store = useSettingsStore();
      const notifications = {
        error: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
        warning: vi.fn()
      };
      const coordinator = useModelSettingsCoordinator({
        api: () =>
          ({
            models: { save: vi.fn().mockRejectedValue(error) }
          }) as unknown as DeepWriteApi,
        settingsStore: store,
        notifications,
        onModelsLoaded: vi.fn()
      });
      await coordinator.saveModelSettings({
        models: [],
        defaultModelId: ""
      });
      expect(store.modelError).toBe(message);
      expect(store.modelSaving).toBe(false);
      expect(notifications.error).toHaveBeenCalledWith(message, {
        duration: 8_000
      });
      expect(notifications.success).not.toHaveBeenCalled();
    }
  );
});
