import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  isWebSearchUsable,
  type WebSearchSettings
} from "@deepwrite/contracts/renderer";
import { deepwriteApi } from "../api/deepwrite";

/**
 * Whether web search can be given to a run, as the session switches need it.
 * The settings page publishes every change here; Main still checks the same
 * condition when a run starts, so a stale value never grants search.
 */
export const useWebSearchStatusStore = defineStore("webSearchStatus", () => {
  const settings = ref<WebSearchSettings | null>(null);
  const usable = computed(
    () => settings.value !== null && isWebSearchUsable(settings.value)
  );
  let loading: Promise<void> | undefined;

  function apply(next: WebSearchSettings): void {
    settings.value = next;
  }

  async function refresh(): Promise<void> {
    try {
      const api = deepwriteApi()?.webSearch;
      if (api) settings.value = await api.getSettings();
    } catch {
      // Without a readable setting the switches stay unavailable.
    }
  }

  /** Reads the settings once; later changes arrive through `apply`. */
  function ensureLoaded(): Promise<void> {
    if (settings.value === null && !loading)
      loading = refresh().finally(() => {
        loading = undefined;
      });
    return loading ?? Promise.resolve();
  }

  return { settings, usable, apply, refresh, ensureLoaded };
});
