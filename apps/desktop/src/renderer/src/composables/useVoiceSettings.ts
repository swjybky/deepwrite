import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { computed, reactive, ref } from "vue";
import type {
  DeepWriteApi,
  VoiceProfileId,
  VoiceSettings,
  VoiceSettingsInput,
  VoiceUsageRecord
} from "@deepwrite/contracts";
import { createDefaultVoiceSettings } from "@deepwrite/contracts/renderer";
import type { PopupSelectOption } from "../types/popupSelect";
import { jsonClone } from "@deepwrite/shared";

const t = createScopedTranslator("workspace.voiceSettings");

interface VoiceSettingsContext {
  api(): DeepWriteApi["voice"] | undefined;
  notifications: {
    warning(message: string): unknown;
    error(message: string): unknown;
    success(message: string): unknown;
  };
}

export function useVoiceSettings(context: VoiceSettingsContext) {
  const settings = ref<VoiceSettings>(createDefaultVoiceSettings());
  const keyDrafts = reactive<Partial<Record<VoiceProfileId, string>>>({});
  const clearKeys = reactive<Partial<Record<VoiceProfileId, boolean>>>({});
  const loading = ref(false);
  const loaded = ref(false);
  const saving = ref(false);
  const usageLoading = ref(false);
  const usage = ref<VoiceUsageRecord[]>([]);
  const microphones = ref<PopupSelectOption[]>([
    { value: "", label: t("systemDefaultMicrophone") }
  ]);
  let disposed = false;
  let editSnapshot: VoiceSettings | undefined;

  function beginEdit(): void {
    editSnapshot = jsonClone(settings.value);
  }

  function cancelEdit(): void {
    if (editSnapshot) settings.value = editSnapshot;
    editSnapshot = undefined;
    clearDraftKeys();
    for (const id of Object.keys(clearKeys))
      delete clearKeys[id as VoiceProfileId];
  }

  const currentProfile = computed(() =>
    settings.value.profiles.find(
      (profile) => profile.id === settings.value.activeProfileId
    )!
  );
  const provider = computed({
    get: () => settings.value.activeProfileId.split("-")[0]!,
    set: (value: string) => {
      if (value !== "mimo" && value !== "aliyun") return;
      settings.value.activeProfileId =
        `${value}-${accessMode.value}` as VoiceProfileId;
    }
  });
  const accessMode = computed<string>({
    get: () =>
      settings.value.activeProfileId.endsWith("token-plan")
        ? ("token-plan" as const)
        : ("api" as const),
    set: (value: string) => {
      if (value !== "token-plan" && value !== "api") return;
      settings.value.activeProfileId =
        `${provider.value}-${value}` as VoiceProfileId;
    }
  });
  const apiKey = computed({
    get: () => keyDrafts[currentProfile.value.id] ?? "",
    set: (value: string) => {
      keyDrafts[currentProfile.value.id] = value;
      if (value.trim()) clearKeys[currentProfile.value.id] = false;
    }
  });
  const keyConfigured = computed(
    () => currentProfile.value.hasApiKey && !clearKeys[currentProfile.value.id]
  );

  function showError(error: unknown, fallback: string): void {
    context.notifications.error(formatError(error, fallback));
  }

  function clearDraftKeys(): void {
    for (const id of Object.keys(keyDrafts))
      delete keyDrafts[id as VoiceProfileId];
  }

  async function load(): Promise<void> {
    const api = context.api();
    if (!api || loading.value || disposed) return;
    loading.value = true;
    try {
      const result = await api.getSettings();
      if (disposed) return;
      settings.value = result;
      loaded.value = true;
    } catch (error) {
      showError(error, t("failedToReadVoiceSettingsPleaseTryAgain"));
    } finally {
      loading.value = false;
    }
  }

  async function refreshUsage(): Promise<void> {
    const api = context.api();
    if (!api || usageLoading.value || disposed) return;
    usageLoading.value = true;
    try {
      const result = await api.getUsage();
      if (!disposed) usage.value = result;
    } catch (error) {
      showError(error, t("failedToReadVoiceUsagePleaseTryAgain"));
    } finally {
      usageLoading.value = false;
    }
  }

  async function refreshMicrophones(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (disposed) return;
      microphones.value = [
        {
          value: "",
          label: t("systemDefaultMicrophone")
        },
        ...devices
          .filter(
            (device) =>
              device.kind === "audioinput" &&
              device.deviceId &&
              device.deviceId !== "default"
          )
          .map((device, index) => ({
            value: device.deviceId,
            label: device.label || t("microphone", { value: index + 1 })
          }))
      ];
      if (
        settings.value.microphoneId &&
        !microphones.value.some(
          (option) => option.value === settings.value.microphoneId
        )
      ) {
        microphones.value.push({
          value: settings.value.microphoneId,
          label: t("selectedMicrophoneNotCurrentlyDetected")
        });
      }
    } catch (error) {
      showError(error, t("cannotReadMicrophoneDevices"));
    }
  }

  function resetCurrentEndpoint(): void {
    const preset = createDefaultVoiceSettings().profiles.find(
      (profile) => profile.id === currentProfile.value.id
    )!;
    currentProfile.value.baseUrl = preset.baseUrl;
    currentProfile.value.model = preset.model;
  }

  function removeCurrentKey(): void {
    keyDrafts[currentProfile.value.id] = "";
    clearKeys[currentProfile.value.id] = true;
  }

  async function save(silent = false): Promise<boolean> {
    const api = context.api();
    if (!api || !loaded.value || saving.value || disposed) return false;
    const input: VoiceSettingsInput = {
      activeProfileId: settings.value.activeProfileId,
      language: settings.value.language,
      microphoneId: settings.value.microphoneId,
      profiles: settings.value.profiles.map((profile) => ({
        id: profile.id,
        baseUrl: profile.baseUrl.trim(),
        model: profile.model.trim(),
        ...(keyDrafts[profile.id]?.trim()
          ? { apiKey: keyDrafts[profile.id]!.trim() }
          : {}),
        ...(clearKeys[profile.id] ? { clearApiKey: true } : {})
      }))
    };
    for (const profile of input.profiles) {
      try {
        const url = new URL(profile.baseUrl);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error();
      } catch {
        context.notifications.warning(
          t("enterAnHttpsEndpointWithoutCredentialsQueryParametersOr")
        );
        return false;
      }
      if (!profile.model) {
        context.notifications.warning(t("enterTheSpeechRecognitionModel"));
        return false;
      }
    }
    saving.value = true;
    try {
      const result = await api.saveSettings(input);
      if (disposed) return false;
      settings.value = result;
      for (const id of Object.keys(clearKeys))
        delete clearKeys[id as VoiceProfileId];
      if (!silent) context.notifications.success(t("voiceSettingsSaved"));
      return true;
    } catch (error) {
      showError(error, t("failedToSaveVoiceSettingsPleaseTryAgain"));
      return false;
    } finally {
      clearDraftKeys();
      saving.value = false;
    }
  }

  async function updateSelection<
    K extends "activeProfileId" | "language" | "microphoneId"
  >(field: K, value: VoiceSettings[K]): Promise<void> {
    if (
      !loaded.value ||
      saving.value ||
      disposed ||
      settings.value[field] === value
    )
      return;
    const previous = settings.value[field];
    settings.value[field] = value;
    if (!(await save(true))) settings.value[field] = previous;
  }

  function dispose(): void {
    disposed = true;
    clearDraftKeys();
  }

  return {
    settings,
    updateSelection,
    beginEdit,
    cancelEdit,
    currentProfile,
    provider,
    accessMode,
    apiKey,
    keyConfigured,
    loading,
    loaded,
    saving,
    usage,
    usageLoading,
    microphones,
    load,
    save,
    refreshUsage,
    refreshMicrophones,
    resetCurrentEndpoint,
    removeCurrentKey,
    dispose
  };
}
