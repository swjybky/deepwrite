import { createScopedTranslator } from "../i18n";
import { computed, ref, watch } from "vue";
import {
  BUILT_IN_REASONING_LEVELS,
  type BuiltInReasoningLevel,
  type ModelApi,
  type ModelConfigInput,
  type RemoteModelListItem,
  type ReasoningLevel,
  type ThinkingLevelOptions,
  type ToolSchemaProfile
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import {
  applyProviderPresetDefaults,
  MODEL_PROVIDER_OPTIONS
} from "../components/modelProviderPresets";
import {
  builtInThinkingLabels,
  cloneDraftModel,
  cloneTemperatureOptions,
  cloneThinkingLevelOptions,
  findCustomThinkingLevel,
  isBuiltInThinkingLevel,
  thinkingLabel,
  toModelInput,
  type DraftModel
} from "../components/modelSettingsDraft";
import { resolveSavedModelLabel } from "../utils/customModelLabel";
import {
  mergeProviderSelectOptions,
  resolveCustomProviderName
} from "../utils/customModelProvider";
import { useRemoteModelListing } from "./useRemoteModelListing";

const t = createScopedTranslator("workspace");

export interface ModelEditorSavePayload {
  model: DraftModel;
  originalId?: string;
  selectedModels?: RemoteModelListItem[];
}

export interface ModelEditorActions {
  save(payload: ModelEditorSavePayload): void;
  test(model: ModelConfigInput): void;
}

const customThinkingLevelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isValidCustomThinkingLevel(level: string): boolean {
  return (
    level.length <= 64 &&
    level !== "off" &&
    !isBuiltInThinkingLevel(level) &&
    customThinkingLevelPattern.test(level)
  );
}

export function useModelEditor(
  initialModel: DraftModel,
  actions: ModelEditorActions,
  options?: {
    model?: () => DraftModel;
    knownUserProviders?: () => readonly string[];
  }
) {
  const editor = ref(cloneDraftModel(initialModel));
  const createdUserProviders = ref<string[]>([]);

  watch(
    () => {
      const current = options?.model?.() ?? initialModel;
      return [
        current.contextWindow,
        current.maxTokens,
        current.supportsDeveloperRole
      ] as const;
    },
    ([contextWindow, maxTokens, supportsDeveloperRole]) => {
      if (
        editor.value.contextWindow === undefined &&
        contextWindow !== undefined
      ) {
        editor.value.contextWindow = contextWindow;
      }
      if (editor.value.maxTokens === undefined && maxTokens !== undefined) {
        editor.value.maxTokens = maxTokens;
      }
      if (
        editor.value.supportsDeveloperRole === undefined &&
        supportsDeveloperRole !== undefined
      ) {
        editor.value.supportsDeveloperRole = supportsDeveloperRole;
      }
    }
  );
  const reasoningOptions = BUILT_IN_REASONING_LEVELS.map((value) => ({
    value,
    label: builtInThinkingLabels[value]
  }));
  const providerOptions = computed(() =>
    mergeProviderSelectOptions(MODEL_PROVIDER_OPTIONS, [
      ...(options?.knownUserProviders?.() ?? []),
      ...createdUserProviders.value,
      editor.value.provider
    ])
  );
  const apiOptions: ReadonlyArray<{ value: ModelApi; label: string }> = [
    { value: "openai-completions", label: "OpenAI Completions" },
    { value: "openai-responses", label: "OpenAI Responses" },
    { value: "anthropic-messages", label: "Anthropic Messages" },
    { value: "google-generative-ai", label: "Google Generative AI" }
  ];
  const toolSchemaProfileOptions = [
    {
      value: "auto",
      get label() {
        return t("modelEditor.automaticRecommended");
      },
      get description() {
        return t(
          "modelEditor.ollamaUsesCompatibilityModeOtherProvidersUseTheNative"
        );
      }
    },
    {
      value: "native",
      get label() {
        return t("modelEditor.piNative");
      },
      get description() {
        return t(
          "modelEditor.keepAllParameterConstraintsForOfficialAndFullyCompatible"
        );
      }
    },
    {
      value: "portable",
      get label() {
        return t("modelEditor.compatibilityMode");
      },
      get description() {
        return t(
          "modelEditor.simplifyParameterConstraintsThatMayCauseLocalModelGrammar"
        );
      }
    }
  ] as const;
  const modelModeOptions = [
    {
      value: "reasoning",
      get label() {
        return t("modelEditor.thinkingMode");
      }
    },
    {
      value: "temperature",
      get label() {
        return t("modelEditor.nonThinkingMode");
      }
    }
  ] as const;
  const defaultThinkingOptions = computed(() =>
    editor.value.thinkingLevelOptions.map((level) => ({
      value: level,
      label: thinkingLabel(level),
      title: level
    }))
  );
  const remoteListing = useRemoteModelListing(editor);

  function applyProviderPreset(provider: string): void {
    applyProviderPresetDefaults(editor.value, provider);
  }

  function applyCustomProvider(name: string): boolean {
    const result = resolveCustomProviderName(name, MODEL_PROVIDER_OPTIONS);
    if (result.status !== "ok") {
      uiMessage.warning(result.message);
      return false;
    }
    if (!createdUserProviders.value.includes(result.provider)) {
      createdUserProviders.value = [
        ...createdUserProviders.value,
        result.provider
      ];
    }
    applyProviderPresetDefaults(editor.value, result.provider);
    return true;
  }

  function setModelApi(value: string | number): void {
    editor.value.api = String(value) as ModelApi;
  }

  function setToolSchemaProfile(value: string | number): void {
    const profile = String(value);
    if (profile === "auto") {
      delete editor.value.toolSchemaProfile;
      return;
    }
    editor.value.toolSchemaProfile = profile as ToolSchemaProfile;
  }

  function setDefaultThinkingLevel(value: string | number): void {
    editor.value.defaultThinkingLevel = String(value);
  }

  function setModelMode(mode: "reasoning" | "temperature"): void {
    const reasoning = mode === "reasoning";
    editor.value.reasoning = reasoning;
    editor.value.defaultThinkingLevel = reasoning
      ? editor.value.thinkingLevelOptions.includes("medium")
        ? "medium"
        : (editor.value.thinkingLevelOptions[0] ?? "medium")
      : "off";
  }

  function toggleThinkingLevelOption(
    level: BuiltInReasoningLevel,
    event: Event
  ): void {
    const input = event.target as HTMLInputElement;
    if (!input.checked && editor.value.thinkingLevelOptions.length === 1) {
      input.checked = true;
      uiMessage.warning(
        t("modelEditor.thinkingModeRequiresAtLeastOneReasoningLevel")
      );
      return;
    }
    const selected = new Set(editor.value.thinkingLevelOptions);
    if (input.checked) selected.add(level);
    else selected.delete(level);
    const customLevel = findCustomThinkingLevel(
      editor.value.thinkingLevelOptions
    );
    editor.value.thinkingLevelOptions = reasoningOptions
      .map((option) => option.value)
      .filter((option) => selected.has(option)) as ThinkingLevelOptions;
    if (customLevel) editor.value.thinkingLevelOptions.push(customLevel);
    if (
      editor.value.reasoning &&
      !editor.value.thinkingLevelOptions.includes(
        editor.value.defaultThinkingLevel as ReasoningLevel
      )
    ) {
      editor.value.defaultThinkingLevel =
        editor.value.thinkingLevelOptions[0] ?? "medium";
    }
  }

  function updateCustomThinkingLevel(event: Event): void {
    const previousCustomLevel = findCustomThinkingLevel(
      editor.value.thinkingLevelOptions
    );
    const customWasDefault =
      previousCustomLevel === editor.value.defaultThinkingLevel;
    const rawValue = (event.target as HTMLInputElement).value;
    const customLevel = rawValue.trim();
    editor.value.customThinkingLevel = rawValue;
    editor.value.thinkingLevelOptions =
      editor.value.thinkingLevelOptions.filter(isBuiltInThinkingLevel);
    if (isValidCustomThinkingLevel(customLevel)) {
      editor.value.thinkingLevelOptions.push(customLevel);
    }
    if (customWasDefault) {
      editor.value.defaultThinkingLevel = isValidCustomThinkingLevel(
        customLevel
      )
        ? customLevel
        : (editor.value.thinkingLevelOptions[0] ?? "medium");
    }
  }

  function save(): void {
    if (
      remoteListing.canSelectRemoteModel.value &&
      !remoteListing.selectedRemoteModels.value.length
    ) {
      uiMessage.warning(t("batchModelSettings.selectAtLeastOneModelToSave"));
      return;
    }
    if (!editor.value.provider.trim() || !editor.value.modelId.trim()) {
      uiMessage.warning(t("modelEditor.enterTheProviderAndModelId"));
      return;
    }
    const customThinkingLevel = editor.value.customThinkingLevel?.trim() ?? "";
    if (
      customThinkingLevel &&
      !isValidCustomThinkingLevel(customThinkingLevel)
    ) {
      uiMessage.warning(
        t("modelEditor.customReasoningLevelsMustDifferFromBuiltInLevels")
      );
      return;
    }
    if (
      !editor.value.reasoning &&
      (editor.value.temperatureOptions.some(
        (temperature) =>
          !Number.isFinite(temperature) || temperature < 0 || temperature > 2
      ) ||
        new Set(editor.value.temperatureOptions).size !==
          editor.value.temperatureOptions.length)
    ) {
      uiMessage.warning(t("modelEditor.enterDifferentTemperaturesBetweenAnd"));
      return;
    }
    if (
      editor.value.reasoning &&
      (!editor.value.thinkingLevelOptions.length ||
        !editor.value.thinkingLevelOptions.includes(
          editor.value.defaultThinkingLevel as ReasoningLevel
        ))
    ) {
      uiMessage.warning(
        t("modelEditor.configureAtLeastOneReasoningLevelAndChooseA")
      );
      return;
    }
    const {
      apiKey,
      customThinkingLevel: _customThinkingLevel,
      originalId,
      ...identity
    } = editor.value;
    actions.save({
      model: {
        ...identity,
        label: editor.value.label.trim(),
        provider: editor.value.provider.trim().toLowerCase(),
        modelId: editor.value.modelId.trim(),
        baseUrl: editor.value.baseUrl.trim(),
        defaultThinkingLevel: editor.value.reasoning
          ? editor.value.defaultThinkingLevel
          : "off",
        thinkingLevelOptions: cloneThinkingLevelOptions(
          editor.value.thinkingLevelOptions
        ),
        temperatureOptions: cloneTemperatureOptions(
          editor.value.temperatureOptions
        ),
        ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
      },
      ...(originalId ? { originalId } : {}),
      ...(remoteListing.canSelectRemoteModel.value
        ? { selectedModels: remoteListing.selectedRemoteModels.value }
        : {})
    });
  }

  function test(): void {
    if (!editor.value.provider.trim() || !editor.value.modelId.trim()) {
      uiMessage.warning(
        t("modelEditor.enterTheProviderAndModelIdBeforeTestingThe")
      );
      return;
    }
    actions.test(
      toModelInput({
        ...editor.value,
        label: resolveSavedModelLabel(editor.value.label, editor.value.modelId)
      })
    );
  }

  return {
    editor,
    reasoningOptions,
    providerOptions,
    apiOptions,
    toolSchemaProfileOptions,
    modelModeOptions,
    defaultThinkingOptions,
    ...remoteListing,
    applyProviderPreset,
    applyCustomProvider,
    setModelApi,
    setToolSchemaProfile,
    setDefaultThinkingLevel,
    setModelMode,
    toggleThinkingLevelOption,
    updateCustomThinkingLevel,
    save,
    test
  };
}
