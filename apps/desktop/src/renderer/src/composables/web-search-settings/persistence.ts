import { onScopeDispose, ref, type Ref } from "vue";
import {
  WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX,
  WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN,
  WebSearchSettingsInputSchema,
  webSearchProvider,
  type WebSearchImportKeyInput,
  type WebSearchSettings
} from "@deepwrite/contracts/renderer";
import { getErrorDetail } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { webSearchApi, webSearchT as t, type WebSearchDraft } from "./bridge";

interface PersistenceContext {
  settings: Ref<WebSearchSettings | null>;
  draft: WebSearchDraft;
  dirty: Ref<boolean>;
  applySettings(snapshot: WebSearchSettings): void;
}

/** Serialize settings, switch and key imports without blocking the form. */
export function useWebSearchSettingsPersistence(context: PersistenceContext) {
  const { settings, draft, dirty, applySettings } = context;
  const saving = ref(false);
  let enabledRevision = 0;
  let writes: Promise<unknown> = Promise.resolve();
  let pendingSave: Promise<void> | undefined;
  let saveRequested = false;

  function write<T>(operation: () => Promise<T>): Promise<T> {
    const pending = writes.then(operation, operation);
    writes = pending.catch(() => undefined);
    return pending;
  }

  function applySnapshot(snapshot: WebSearchSettings, revision: number): void {
    applySettings(
      revision !== enabledRevision && settings.value
        ? { ...snapshot, enabled: settings.value.enabled }
        : snapshot
    );
  }

  function validNumbers(): boolean {
    return (
      Number.isInteger(draft.maxResults) &&
      draft.maxResults >= 1 &&
      draft.maxResults <=
        webSearchProvider(draft.activeProviderId).maxResultsCap &&
      Number.isInteger(draft.perRunCallLimit) &&
      draft.perRunCallLimit >= WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN &&
      draft.perRunCallLimit <= WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX
    );
  }

  async function persist(): Promise<void> {
    saving.value = true;
    try {
      while (saveRequested) {
        saveRequested = false;
        if (!settings.value || !dirty.value || !validNumbers()) continue;
        const submitted = { ...draft };
        const revision = enabledRevision;
        try {
          const apiKey = submitted.apiKey.trim();
          const snapshot = await write(() =>
            webSearchApi().saveSettings(
              WebSearchSettingsInputSchema.parse({
                enabled: settings.value!.enabled,
                activeProviderId: submitted.activeProviderId,
                perRunCallLimit: submitted.perRunCallLimit,
                profiles: [
                  {
                    providerId: submitted.activeProviderId,
                    maxResults: submitted.maxResults,
                    ...(submitted.baseUrl?.trim()
                      ? { baseUrl: submitted.baseUrl.trim() }
                      : {}),
                    ...(apiKey
                      ? { apiKey }
                      : submitted.clearKey
                        ? { clearApiKey: true }
                        : {})
                  }
                ]
              })
            )
          );
          applySnapshot(snapshot, revision);
          // A reply must not erase a key entered while the write was running.
          if (
            draft.activeProviderId === submitted.activeProviderId &&
            draft.apiKey === submitted.apiKey &&
            draft.clearKey === submitted.clearKey
          ) {
            draft.apiKey = "";
            draft.clearKey = false;
          }
        } catch (error) {
          if (
            submitted.clearKey &&
            draft.activeProviderId === submitted.activeProviderId &&
            draft.apiKey === submitted.apiKey
          )
            draft.clearKey = false;
          uiMessage.error(getErrorDetail(error) ?? t("saveFailed"));
        }
      }
    } finally {
      saving.value = false;
    }
  }

  function save(): Promise<void> {
    if (!settings.value || (!dirty.value && !pendingSave))
      return pendingSave ?? Promise.resolve();
    if (!validNumbers()) {
      uiMessage.warning(
        t("invalidNumbers", {
          minResults: 1,
          maxResults: webSearchProvider(draft.activeProviderId).maxResultsCap,
          minCalls: WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN,
          maxCalls: WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX
        })
      );
      return pendingSave ?? Promise.resolve();
    }
    saveRequested = true;
    pendingSave ??= persist().finally(() => {
      pendingSave = undefined;
    });
    return pendingSave;
  }

  /** Optimistic switches keep their newest intent across all queued writes. */
  async function setEnabled(enabled: boolean): Promise<void> {
    const current = settings.value;
    if (!current || current.enabled === enabled) return;
    const revision = ++enabledRevision;
    applySettings({ ...current, enabled });
    await write(async () => {
      try {
        applySnapshot(await webSearchApi().setEnabled({ enabled }), revision);
      } catch (error) {
        uiMessage.error(getErrorDetail(error) ?? t("toggleFailed"));
        try {
          applySnapshot(await webSearchApi().getSettings(), revision);
        } catch {
          if (revision === enabledRevision && settings.value)
            applySettings({ ...settings.value, enabled: current.enabled });
        }
      }
    });
  }

  async function importKey(input: WebSearchImportKeyInput): Promise<void> {
    const revision = enabledRevision;
    await write(async () => {
      applySnapshot(await webSearchApi().importKey(input), revision);
    });
  }

  function clearKey(): Promise<void> {
    draft.apiKey = "";
    draft.clearKey = true;
    return save();
  }

  // A category change can unmount a still-focused input before its change event.
  onScopeDispose(() => {
    if (validNumbers()) void save();
  });

  return { saving, save, setEnabled, importKey, clearKey };
}
