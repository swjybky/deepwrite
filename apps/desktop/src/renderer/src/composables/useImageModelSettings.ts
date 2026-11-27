import { identityApi } from "../extras/book-identity/book-identity-utils";
import { computed, ref } from "vue";
import { createId } from "@deepwrite/shared";
import {
  IMAGE_MODEL_PRESETS,
  imageModelCapability,
  ImageModelSettingsInputSchema,
  type ImageModelSettings,
  type ImageModelProfileInput,
  type ImagePresetId,
  type ImageUsageRecord
} from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../i18n";
import { getErrorDetail } from "../i18n/errors";
import { uiMessage } from "../ui-feedback";
import { uiConfirm } from "../ui-confirm";
const t = createScopedTranslator("components.imageModelSettings");
export function useImageModelSettings() {
  const settings = ref<ImageModelSettings>({
    activeProfileId: null,
    profiles: []
  });
  const draft = ref<ImageModelProfileInput | null>(null);
  const loading = ref(false),
    saving = ref(false),
    loaded = ref(false);
  const usage = ref<ImageUsageRecord[]>([]);
  const preview = ref("");
  const testRequestId = ref<string | null>(null);
  const current = computed(() =>
    settings.value.profiles.find((p) => p.id === settings.value.activeProfileId)
  );
  async function act<T>(operation: () => Promise<T>): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      uiMessage.error(getErrorDetail(error) ?? t("error"));
      return undefined;
    }
  }
  async function load() {
    loading.value = true;
    await act(async () => {
      settings.value = await identityApi().imageModels.getSettings();
      loaded.value = true;
    });
    loading.value = false;
  }
  async function refreshUsage() {
    await act(async () => {
      usage.value = await identityApi().imageModels.getUsage();
    });
  }
  function applyPreset(id: ImagePresetId) {
    if (!draft.value) return;
    const p = IMAGE_MODEL_PRESETS[id];
    Object.assign(draft.value, {
      presetId: id,
      baseUrl: p.baseUrl,
      model: p.model,
      defaultAspectRatio: imageModelCapability(id, p.model).aspectRatios[0],
      quality: undefined,
      watermark: p.supportsWatermark ? false : undefined
    });
  }
  function edit(add = false, id = settings.value.activeProfileId) {
    if (add) {
      if (settings.value.profiles.length >= 12) {
        uiMessage.warning(t("maxProfiles"));
        return;
      }
      const p = IMAGE_MODEL_PRESETS["volcengine-seedream"];
      draft.value = {
        presetId: p.id,
        name: t("newName", { count: settings.value.profiles.length + 1 }),
        baseUrl: p.baseUrl,
        model: p.model,
        defaultAspectRatio: "3:4",
        watermark: false
      };
    } else {
      const selected = settings.value.profiles.find(
        (profile) => profile.id === id
      );
      if (selected) {
        const { hasApiKey: _key, ...profile } = selected;
        draft.value = { ...profile };
      }
    }
  }
  function inputs() {
    return settings.value.profiles.map(
      ({ hasApiKey: _key, ...profile }) => profile
    );
  }
  async function persist(
    profiles: ImageModelProfileInput[],
    activeProfileId = settings.value.activeProfileId
  ) {
    saving.value = true;
    const result = await act(async () => {
      const input = ImageModelSettingsInputSchema.parse({
        profiles,
        activeProfileId
      });
      settings.value = await identityApi().imageModels.saveSettings(input);
      return true;
    });
    saving.value = false;
    return result;
  }
  async function save() {
    if (!draft.value) return;
    const existing = inputs().filter((p) => p.id !== draft.value!.id);
    if (await persist([...existing, draft.value])) {
      draft.value = null;
      uiMessage.success(t("saved"));
    }
  }
  async function select(id: string) {
    await persist(inputs(), id);
  }
  async function remove(id = settings.value.activeProfileId) {
    if (
      !id ||
      !(await uiConfirm({ message: t("deleteConfirm"), danger: true }))
    )
      return;
    await persist(inputs().filter((p) => p.id !== id));
  }
  async function test(prompt: string) {
    if (!current.value || testRequestId.value) return;
    const requestId = createId("image_test");
    testRequestId.value = requestId;
    await act(async () => {
      const result = await identityApi().imageModels.test({
        requestId,
        profileId: current.value!.id,
        prompt,
        aspectRatio: current.value!.defaultAspectRatio
      });
      preview.value = result.previewDataUrl;
    });
    if (testRequestId.value === requestId) testRequestId.value = null;
    await refreshUsage();
  }
  async function stop() {
    if (testRequestId.value)
      await act(() =>
        identityApi().imageModels.cancel({ requestId: testRequestId.value! })
      );
  }
  return {
    settings,
    draft,
    loading,
    saving,
    loaded,
    usage,
    preview,
    testRequestId,
    current,
    load,
    refreshUsage,
    edit,
    applyPreset,
    save,
    select,
    remove,
    test,
    stop
  };
}
export type ImageModelSettingsController = ReturnType<
  typeof useImageModelSettings
>;
