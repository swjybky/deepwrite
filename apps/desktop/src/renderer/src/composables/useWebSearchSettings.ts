import { computed, reactive, ref, watch } from "vue";
import {
  WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX,
  WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN,
  webSearchProvider,
  type WebSearchProviderId,
  type WebSearchSettings
} from "@deepwrite/contracts/renderer";
import { locale } from "../i18n";
import { getErrorDetail } from "../i18n/errors";
import { useWebSearchStatusStore } from "../stores/webSearchStatus";
import { uiMessage } from "../ui-feedback";
import {
  webSearchApi,
  webSearchProviderLabel,
  webSearchProviderName,
  webSearchT as t,
  type WebSearchDraft
} from "./web-search-settings/bridge";
import { useWebSearchKeyImport } from "./web-search-settings/key-import";
import { useWebSearchSettingsPersistence } from "./web-search-settings/persistence";

export { webSearchProviderLabel };

/**
 * The settings form saves completed edits directly. Background writes never
 * disable unrelated controls or replace newer edits with an older reply.
 */
export function useWebSearchSettings() {
  const settings = ref<WebSearchSettings | null>(null);
  const status = useWebSearchStatusStore();
  const draft = reactive<WebSearchDraft>({
    activeProviderId: "deepseek",
    maxResults: 8,
    baseUrl: "",
    perRunCallLimit: 20,
    apiKey: "",
    clearKey: false
  });
  const loaded = ref(false);
  // Counts as loading from the start, so nothing flashes before the first read.
  const loading = ref(true);
  const testing = ref(false);
  let loadRevision = 0;

  const profile = computed(() =>
    settings.value?.profiles.find(
      (entry) => entry.providerId === draft.activeProviderId
    )
  );
  const descriptor = computed(() => webSearchProvider(draft.activeProviderId));
  const provider = computed(() =>
    webSearchProviderName(draft.activeProviderId)
  );
  const providerLabel = computed(() =>
    webSearchProviderLabel(draft.activeProviderId)
  );
  const canImport = computed(() => Boolean(descriptor.value.keyImport));
  const hasUsableKey = computed(
    () =>
      descriptor.value.requiresApiKey === false ||
      draft.apiKey.trim() !== "" ||
      (Boolean(profile.value?.hasApiKey) && !draft.clearKey)
  );
  const dirty = computed(() => {
    const saved = settings.value;
    if (!saved) return false;
    return (
      draft.apiKey.trim() !== "" ||
      draft.clearKey ||
      (draft.baseUrl?.trim() || undefined) !== profile.value?.baseUrl ||
      draft.activeProviderId !== saved.activeProviderId ||
      draft.perRunCallLimit !== saved.perRunCallLimit ||
      draft.maxResults !== profile.value?.maxResults
    );
  });
  const limits = computed(() => ({
    minResults: 1,
    maxResults: descriptor.value.maxResultsCap,
    minCalls: WEB_SEARCH_PER_RUN_CALL_LIMIT_MIN,
    maxCalls: WEB_SEARCH_PER_RUN_CALL_LIMIT_MAX
  }));

  function resetKeyDraft(): void {
    draft.apiKey = "";
    draft.clearKey = false;
  }

  function applySettings(snapshot: WebSearchSettings): void {
    settings.value = snapshot;
    status.apply(snapshot);
  }

  const persistence = useWebSearchSettingsPersistence({
    settings,
    draft,
    dirty,
    applySettings
  });
  const keyImport = useWebSearchKeyImport({
    draft,
    provider,
    canImport,
    resetKeyDraft,
    importKey: persistence.importKey
  });
  watch(
    () => [loaded.value, draft.activeProviderId, profile.value?.hasApiKey],
    () => {
      if (loaded.value && settings.value)
        void keyImport.detectImportable(settings.value);
    }
  );

  const statusText = computed(() => {
    const saved = settings.value;
    if (!saved) return "";
    if (!descriptor.value.defaultBaseUrl && !draft.baseUrl?.trim())
      return t("statusNeedsEndpoint");
    if (descriptor.value.requiresApiKey !== false && !profile.value?.hasApiKey)
      return keyImport.importHint.value
        ? t("statusNoKeyImportable", { provider: provider.value })
        : t("statusNoKey");
    return saved.enabled
      ? t("statusOn", { provider: providerLabel.value })
      : t("statusOff");
  });
  const keySourceText = computed(() => {
    const source = profile.value?.keySource;
    if (!profile.value?.hasApiKey)
      return t(
        descriptor.value.requiresApiKey === false
          ? "optionalKey"
          : "keyNotSaved"
      );
    if (!source || source.kind === "manual") return t("keySourceManual");
    return t("keySourceModel", {
      model: source.modelLabel,
      date: new Date(source.importedAt).toLocaleDateString(locale.value, {
        month: "long",
        day: "numeric"
      })
    });
  });

  function maxResultsOf(
    snapshot: WebSearchSettings,
    id: WebSearchProviderId
  ): number {
    return (
      snapshot.profiles.find((entry) => entry.providerId === id)?.maxResults ??
      webSearchProvider(id).defaultMaxResults
    );
  }

  function syncDraft(snapshot: WebSearchSettings): void {
    draft.activeProviderId = snapshot.activeProviderId;
    draft.perRunCallLimit = snapshot.perRunCallLimit;
    draft.maxResults = maxResultsOf(snapshot, snapshot.activeProviderId);
    draft.baseUrl =
      snapshot.profiles.find(
        (entry) => entry.providerId === snapshot.activeProviderId
      )?.baseUrl ?? "";
    resetKeyDraft();
  }

  async function load(): Promise<void> {
    const revision = ++loadRevision;
    loading.value = true;
    try {
      const snapshot = await webSearchApi().getSettings();
      if (revision !== loadRevision) return;
      applySettings(snapshot);
      syncDraft(snapshot);
      loaded.value = true;
    } catch (error) {
      if (revision === loadRevision)
        uiMessage.error(getErrorDetail(error) ?? t("loadFailed"));
    } finally {
      if (revision === loadRevision) loading.value = false;
    }
  }

  async function selectProvider(id: WebSearchProviderId): Promise<void> {
    if (id === draft.activeProviderId) return;
    draft.activeProviderId = id;
    draft.baseUrl =
      settings.value?.profiles.find((entry) => entry.providerId === id)
        ?.baseUrl ?? "";
    draft.maxResults = settings.value
      ? maxResultsOf(settings.value, id)
      : webSearchProvider(id).defaultMaxResults;
    resetKeyDraft();
    await persistence.save();
  }

  async function test(): Promise<void> {
    if (testing.value) return;
    if (!(draft.baseUrl?.trim() || descriptor.value.defaultBaseUrl)) {
      uiMessage.warning(t("statusNeedsEndpoint"));
      return;
    }
    if (!hasUsableKey.value) {
      uiMessage.warning(t("testNeedsKey"));
      return;
    }
    testing.value = true;
    try {
      const apiKey = draft.apiKey.trim();
      const result = await webSearchApi().test({
        providerId: draft.activeProviderId,
        baseUrl: draft.baseUrl?.trim() || descriptor.value.defaultBaseUrl,
        ...(apiKey ? { apiKey } : {})
      });
      uiMessage.success(
        t("testSuccess", {
          count: result.resultCount,
          seconds: (result.elapsedMs / 1000).toFixed(1)
        })
      );
    } catch (error) {
      uiMessage.error(getErrorDetail(error) ?? t("testFailed"));
    } finally {
      testing.value = false;
    }
  }

  return {
    settings,
    draft,
    loaded,
    loading,
    saving: persistence.saving,
    testing,
    profile,
    descriptor,
    provider,
    providerLabel,
    canImport,
    hasUsableKey,
    dirty,
    limits,
    statusText,
    keySourceText,
    load,
    selectProvider,
    setEnabled: persistence.setEnabled,
    save: persistence.save,
    test,
    clearKey: persistence.clearKey,
    importing: keyImport.importing,
    importRequest: keyImport.importRequest,
    importConfirming: keyImport.importConfirming,
    startImport: keyImport.startImport,
    confirmImport: keyImport.confirmImport,
    cancelImport: keyImport.cancelImport
  };
}

export type WebSearchSettingsController = ReturnType<
  typeof useWebSearchSettings
>;
