import type { useSettingsStore } from "../stores/settingsStore";

type SettingsStore = ReturnType<typeof useSettingsStore>;
const generations = new WeakMap<SettingsStore, number>();

export function invalidateSiteOfficialQuota(store: SettingsStore): void {
  generations.set(store, (generations.get(store) ?? 0) + 1);
}

export function beginSiteOfficialQuotaRequest(store: SettingsStore) {
  invalidateSiteOfficialQuota(store);
  const generation = generations.get(store);
  const settings = store.modelSettings;
  return () =>
    generations.get(store) === generation && store.modelSettings === settings;
}
