import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import type { DeepWriteApi, ModelSettings } from "@deepwrite/contracts";
import { useSettingsStore } from "../stores/settingsStore";
import { useModelSettingsCoordinator } from "./useModelSettingsCoordinator";

function deferred() {
  let resolve!: (settings: ModelSettings) => void;
  const promise = new Promise<ModelSettings>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(list = vi.fn()) {
  const store = useSettingsStore();
  const notifications = {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  };
  const onModelsLoaded = vi.fn();
  const coordinator = useModelSettingsCoordinator({
    api: () => ({ models: { list } }) as unknown as DeepWriteApi,
    settingsStore: store,
    notifications,
    onModelsLoaded
  });
  return { store, list, notifications, onModelsLoaded, ...coordinator };
}

const settings = (id: string): ModelSettings => ({
  defaultModelId: id,
  models: []
});

beforeEach(() => setActivePinia(createPinia()));

it("rereads external model changes on every refresh while ordinary loads reuse the snapshot", async () => {
  const h = harness();
  h.list.mockResolvedValueOnce(settings("original"));
  await h.loadModelSettings();
  h.list.mockResolvedValueOnce(settings("external-update"));
  await h.refreshModelSettings();
  expect(h.store.modelSettings?.defaultModelId).toBe("external-update");
  h.list.mockResolvedValueOnce(settings("second-update"));
  await h.refreshModelSettings();
  await h.loadModelSettings();
  expect(h.list).toHaveBeenCalledTimes(3);
  expect(h.store.modelSettings?.defaultModelId).toBe("second-update");
  expect(h.onModelsLoaded).toHaveBeenLastCalledWith(settings("second-update"));
});

it("ignores an earlier cached load when it finishes after a refresh", async () => {
  const old = deferred();
  const h = harness(
    vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(settings("new"))
  );
  const first = h.loadModelSettings();
  await h.refreshModelSettings();
  old.resolve(settings("old"));
  await first;
  expect(h.store.modelSettings?.defaultModelId).toBe("new");
  expect(h.onModelsLoaded).toHaveBeenCalledTimes(1);
});

it("keeps the latest refresh when responses arrive out of order", async () => {
  const old = deferred();
  const h = harness(
    vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(settings("new"))
  );
  const first = h.refreshModelSettings();
  await h.refreshModelSettings();
  old.resolve(settings("old"));
  await first;
  expect(h.store.modelSettings?.defaultModelId).toBe("new");
  expect(h.onModelsLoaded).toHaveBeenCalledTimes(1);
});

it("does not replace a newer save with an in-flight refresh", async () => {
  const pending = deferred();
  const h = harness(vi.fn(() => pending.promise));
  const request = h.refreshModelSettings();
  h.store.markLoaded("models", settings("saved"));
  pending.resolve(settings("before-save"));
  await request;
  expect(h.store.modelSettings?.defaultModelId).toBe("saved");
  expect(h.onModelsLoaded).not.toHaveBeenCalled();
});

it("retains visible models on failure, reports a toast, and retries on the next refresh", async () => {
  const h = harness(
    vi
      .fn()
      .mockRejectedValueOnce(new Error("Read failed"))
      .mockResolvedValueOnce(settings("recovered"))
  );
  h.store.markLoaded("models", settings("previous"));
  await h.refreshModelSettings();
  expect(h.store.modelSettings?.defaultModelId).toBe("previous");
  expect(h.store.modelLoading).toBe(false);
  expect(h.notifications.error).toHaveBeenCalledWith("Read failed");
  await h.refreshModelSettings();
  expect(h.store.modelSettings?.defaultModelId).toBe("recovered");
  expect(h.store.modelError).toBeNull();
});
