import { createScopedTranslator } from "../i18n";
import { computed, ref, watch, type Ref } from "vue";
import type { RemoteModelListItem } from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import type { DraftModel } from "../components/modelSettingsDraft";
import { deepwriteApi } from "../api/deepwrite";

const t = createScopedTranslator("workspace.remoteModelListing");

function missingCredentials(editor: DraftModel): string | null {
  const missingUrl = !editor.baseUrl.trim();
  const missingKey =
    !editor.apiKey?.trim() && !editor.hasApiKey && editor.provider !== "ollama";
  if (missingUrl && missingKey) {
    return t("enterTheApiUrlAndApiKeyBeforeFetching");
  }
  if (missingUrl) return t("enterTheApiUrlBeforeFetchingAvailableModels");
  if (missingKey) return t("enterTheApiKeyBeforeFetchingAvailableModels");
  return null;
}

function commandErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  const separator = error.message.indexOf(": ");
  return separator >= 0 ? error.message.slice(separator + 2) : error.message;
}

export function useRemoteModelListing(editor: Ref<DraftModel>) {
  const fetchedRemoteModels = ref<RemoteModelListItem[]>([]);
  const listingRemoteModels = ref(false);
  const fetchHintDialog = ref<string | null>(null);

  const selectedRemoteModelIds = ref<string[]>([]);
  let requestVersion = 0;
  const canSelectRemoteModel = computed(
    () => fetchedRemoteModels.value.length > 0
  );
  const selectedRemoteModels = computed(() =>
    fetchedRemoteModels.value.filter((model) =>
      selectedRemoteModelIds.value.includes(model.id)
    )
  );
  const remoteModelOptions = computed(() =>
    fetchedRemoteModels.value.map((model) => ({
      value: model.id,
      label: model.label || model.id,
      ...(model.label && model.label !== model.id
        ? { description: model.id }
        : {}),
      title: model.id
    }))
  );

  function clearRemoteModels(): void {
    requestVersion++;
    fetchedRemoteModels.value = [];
    selectedRemoteModelIds.value = [];
    listingRemoteModels.value = false;
  }

  watch(
    () => [
      editor.value.id,
      editor.value.provider,
      editor.value.api,
      editor.value.baseUrl.trim(),
      editor.value.apiKey,
      editor.value.clearApiKey
    ],
    clearRemoteModels
  );

  function setSelectedRemoteModels(values: (string | number)[]): void {
    selectedRemoteModelIds.value = values.map(String);
    const selected = selectedRemoteModels.value;
    if (
      selected.length &&
      !selected.some((model) => model.id === editor.value.modelId)
    ) {
      editor.value.modelId = selected[0]!.id;
    }
  }

  async function fetchRemoteModels(): Promise<void> {
    if (listingRemoteModels.value) return;
    const missing = missingCredentials(editor.value);
    if (missing) {
      fetchHintDialog.value = missing;
      return;
    }
    const desktopApi = deepwriteApi();
    if (!desktopApi) {
      uiMessage.error(t("modelListingIsNotAvailableInThisEnvironment"));
      return;
    }
    const version = ++requestVersion;
    listingRemoteModels.value = true;
    try {
      const result = await desktopApi.models.listRemote({
        id: editor.value.originalId ?? editor.value.id,
        provider: editor.value.provider.trim(),
        api: editor.value.api,
        baseUrl: editor.value.baseUrl.trim(),
        ...(editor.value.apiKey?.trim()
          ? { apiKey: editor.value.apiKey.trim() }
          : {}),
        ...(editor.value.clearApiKey ? { clearApiKey: true } : {})
      });
      if (version !== requestVersion) return;
      fetchedRemoteModels.value = [
        ...new Map(result.models.map((model) => [model.id, model])).values()
      ];
      selectedRemoteModelIds.value = result.models.some(
        (model) => model.id === editor.value.modelId
      )
        ? [editor.value.modelId]
        : [];
      if (result.models.length === 0) {
        uiMessage.warning(t("thisEndpointReturnedNoAvailableModels"));
        return;
      }
      uiMessage.success(
        t("foundAvailableModelsSelectTheModelsToSave", {
          length: result.models.length
        })
      );
    } catch (error: unknown) {
      if (version !== requestVersion) return;
      uiMessage.error(commandErrorMessage(error, t("failedToFetchModelList")));
    } finally {
      if (version === requestVersion) listingRemoteModels.value = false;
    }
  }

  return {
    canSelectRemoteModel,
    remoteModelOptions,
    listingRemoteModels,
    fetchHintDialog,
    selectedRemoteModelIds,
    selectedRemoteModels,
    setSelectedRemoteModels,
    clearRemoteModels,
    fetchRemoteModels
  };
}
