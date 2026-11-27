import { computed, ref, type Ref } from "vue";
import { optionalUiStorage } from "../../utils/uiStorage";

export const CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY =
  "deepwrite:chat-assistant-web-search:v1";

interface WebSearchPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ChatAssistantWebSearchOptions {
  /** Whether the search settings let a run search at all. */
  available: Readonly<Ref<boolean>>;
  storage?: WebSearchPreferenceStorage | null;
}

function defaultStorage(): WebSearchPreferenceStorage | null {
  try {
    return optionalUiStorage();
  } catch {
    return null;
  }
}

function readPreference(storage: WebSearchPreferenceStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * The chat assistant's own search switch. It is remembered even while the
 * settings turn search off, and only counts while the settings allow it.
 */
export function useChatAssistantWebSearch(
  options: ChatAssistantWebSearchOptions
) {
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage;
  const preference = ref(readPreference(storage));

  function persist(value: boolean): void {
    if (!storage) return;
    try {
      storage.setItem(CHAT_ASSISTANT_WEB_SEARCH_STORAGE_KEY, String(value));
    } catch {
      // Persistence is optional; the in-memory preference remains usable.
    }
  }

  function setEnabled(value: boolean): boolean {
    if (value && !options.available.value) return false;
    preference.value = value;
    persist(value);
    return true;
  }

  return {
    available: options.available,
    /** What the switch shows and what a turn sends. */
    enabled: computed(() => preference.value && options.available.value),
    setEnabled
  };
}

export type ChatAssistantWebSearchFeature = ReturnType<
  typeof useChatAssistantWebSearch
>;
