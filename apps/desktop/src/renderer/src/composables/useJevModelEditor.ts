import { createScopedTranslator } from "../i18n";
import { computed, ref, watch } from "vue";
import {
  normalizeJevModelIdentity,
  resolveJevApiRoot
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  findJevProviderPreset,
  JEV_CUSTOM_PROVIDER,
  JEV_PROVIDER_PRESETS,
  jevModelIdKindLabel
} from "../components/jevProviderPresets";
import {
  cloneDraftModel,
  toModelInput,
  type DraftModel
} from "../components/modelSettingsDraft";
import type { PopupSelectOption } from "../types/popupSelect";
import { resolveSavedModelLabel } from "../utils/customModelLabel";
import type { ModelEditorActions } from "./useModelEditor";

const t = createScopedTranslator("components.jevModelEditorPanel");
const tl = createScopedTranslator("workspace.remoteModelListing");

// Match judgment models, excluding chat routers such as `typesafe/jev-router`.
const JEV_ID_PATTERN = /(?:^|[/-])jev(?:-\d[\d.-]*|-(?:latest|preview))?$/iu;

function commandErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  const separator = error.message.indexOf(": ");
  return separator >= 0 ? error.message.slice(separator + 2) : error.message;
}

/** Strips every text-generation field; Jev only needs URL, key and model ID. */
export function toJevDraft(model: DraftModel): DraftModel {
  const { customThinkingLevel: _custom, ...rest } = model;
  return normalizeJevModelIdentity({
    ...rest,
    label: model.label.trim(),
    provider: model.provider.trim().toLowerCase(),
    modelId: model.modelId.trim(),
    baseUrl: model.baseUrl.trim()
  });
}

export function useJevModelEditor(
  initialModel: DraftModel,
  actions: ModelEditorActions
) {
  const editor = ref(cloneDraftModel(initialModel));
  const fetchedModelIds = ref<string[]>([]);
  const listing = ref(false);
  const manualModelId = ref(false);
  let requestVersion = 0;
  // A new draft on a non-Jev host (legacy defaults) starts on TypeSafe.
  if (
    !initialModel.originalId &&
    !findJevProviderPreset(initialModel.provider)
  ) {
    applyProvider("typesafe");
  }

  const preset = computed(() => findJevProviderPreset(editor.value.provider));
  const providerOptions = computed<PopupSelectOption[]>(() => {
    const options: PopupSelectOption[] = JEV_PROVIDER_PRESETS.map((entry) => ({
      value: entry.value,
      label: entry.label,
      ...(entry.description ? { description: entry.description } : {})
    }));
    if (!preset.value && editor.value.provider) {
      options.push({
        value: editor.value.provider,
        label: editor.value.provider
      });
    }
    return options;
  });
  const modelIdOptions = computed<PopupSelectOption[]>(() => {
    const options = new Map<string, PopupSelectOption>();
    for (const entry of preset.value?.modelIds ?? []) {
      options.set(entry.id, {
        value: entry.id,
        label: entry.id,
        description: jevModelIdKindLabel(entry.kind)
      });
    }
    for (const id of fetchedModelIds.value) {
      if (!options.has(id)) options.set(id, { value: id, label: id });
    }
    return [...options.values()];
  });
  const showModelIdInput = computed(
    () =>
      manualModelId.value ||
      modelIdOptions.value.length === 0 ||
      (Boolean(editor.value.modelId.trim()) &&
        !modelIdOptions.value.some(
          (option) => option.value === editor.value.modelId
        ))
  );
  const canFetchModels = computed(
    () => preset.value?.supportsModelList ?? true
  );

  watch(
    () => [editor.value.provider, editor.value.baseUrl.trim()],
    () => {
      requestVersion++;
      fetchedModelIds.value = [];
      listing.value = false;
    }
  );

  function applyProvider(provider: string): void {
    const next = findJevProviderPreset(provider);
    editor.value.provider = provider;
    if (!next) return;
    if (next.value !== JEV_CUSTOM_PROVIDER) editor.value.baseUrl = next.baseUrl;
    const firstId = next.modelIds[0]?.id;
    if (
      firstId &&
      !next.modelIds.some((entry) => entry.id === editor.value.modelId)
    ) {
      editor.value.modelId = firstId;
    }
    manualModelId.value = false;
  }

  function setProvider(value: string | number): void {
    applyProvider(String(value));
  }

  function setModelId(value: string | number): void {
    editor.value.modelId = String(value);
    manualModelId.value = false;
  }

  function useManualModelId(): void {
    manualModelId.value = true;
  }

  async function fetchModels(): Promise<void> {
    if (listing.value || !canFetchModels.value) return;
    const root = resolveJevApiRoot(editor.value.baseUrl);
    if (!root) {
      uiMessage.warning(tl("enterTheApiUrlBeforeFetchingAvailableModels"));
      return;
    }
    if (!editor.value.apiKey?.trim() && !editor.value.hasApiKey) {
      uiMessage.warning(tl("enterTheApiKeyBeforeFetchingAvailableModels"));
      return;
    }
    if (!window.deepwrite) {
      uiMessage.error(tl("modelListingIsNotAvailableInThisEnvironment"));
      return;
    }
    const version = ++requestVersion;
    listing.value = true;
    try {
      const result = await window.deepwrite.models.listRemote({
        id: editor.value.originalId ?? editor.value.id,
        provider: editor.value.provider.trim() || JEV_CUSTOM_PROVIDER,
        api: "openai-completions",
        baseUrl: root,
        ...(editor.value.apiKey?.trim()
          ? { apiKey: editor.value.apiKey.trim() }
          : {}),
        ...(editor.value.clearApiKey ? { clearApiKey: true } : {})
      });
      if (version !== requestVersion) return;
      // Aggregators list every hosted model; keep only Jev judgment entries.
      const ids = result.models
        .map((model) => model.id)
        .filter((id) => JEV_ID_PATTERN.test(id));
      fetchedModelIds.value = [...new Set(ids)];
      if (!ids.length) {
        uiMessage.warning(t("noJevModelsFound"));
        return;
      }
      manualModelId.value = false;
      if (!ids.includes(editor.value.modelId)) editor.value.modelId = ids[0]!;
      uiMessage.success(t("foundJevModels", { count: ids.length }));
    } catch (error: unknown) {
      if (version !== requestVersion) return;
      uiMessage.error(commandErrorMessage(error, tl("failedToFetchModelList")));
    } finally {
      if (version === requestVersion) listing.value = false;
    }
  }

  function validate(): boolean {
    if (!editor.value.modelId.trim()) {
      uiMessage.warning(t("enterTheModelId"));
      return false;
    }
    if (!editor.value.baseUrl.trim()) {
      uiMessage.warning(t("enterTheApiEndpoint"));
      return false;
    }
    if (!editor.value.provider.trim())
      editor.value.provider = JEV_CUSTOM_PROVIDER;
    return true;
  }

  function save(): void {
    if (!validate()) return;
    const { apiKey, originalId, ...identity } = toJevDraft(editor.value);
    actions.save({
      model: {
        ...identity,
        ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
      },
      ...(originalId ? { originalId } : {})
    });
  }

  function test(): void {
    if (!validate()) return;
    const draft = toJevDraft(editor.value);
    actions.test(
      toModelInput({
        ...draft,
        label: resolveSavedModelLabel(draft.label, draft.modelId)
      })
    );
  }

  function clearSavedKey(): void {
    editor.value.hasApiKey = false;
    editor.value.clearApiKey = true;
    editor.value.apiKey = "";
  }

  return {
    editor,
    providerOptions,
    modelIdOptions,
    showModelIdInput,
    canFetchModels,
    listing,
    setProvider,
    setModelId,
    useManualModelId,
    fetchModels,
    clearSavedKey,
    save,
    test
  };
}
