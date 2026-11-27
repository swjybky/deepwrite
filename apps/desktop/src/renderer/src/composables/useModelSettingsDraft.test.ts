import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftModel } from "../components/modelSettingsDraft";
import { useSettingsStore } from "../stores/settingsStore";
import {
  useModelSettingsDraft,
  type ModelSettingsDraftProps
} from "./useModelSettingsDraft";

const scopes: ReturnType<typeof effectScope>[] = [];

function model(id: string): DraftModel {
  return {
    id,
    label: id,
    provider: "custom",
    modelId: id,
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    defaultThinkingLevel: "off",
    thinkingLevelOptions: ["medium"],
    temperatureOptions: [0.1, 0.7, 1],
    hasApiKey: false
  };
}

function setup() {
  const props = reactive<ModelSettingsDraftProps>({
    active: true,
    modelScope: "custom",
    modelSettings: { models: [model("existing")], defaultModelId: "existing" },
    modelLoading: false,
    modelSaving: false,
    modelError: null,
    modelTestMessage: null,
    testingModelId: null
  });
  const saveModels = vi.fn();
  const cancelTestModel = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const draft = scope.run(() =>
    useModelSettingsDraft(props, {
      saveModels,
      testModel: vi.fn(),
      cancelTestModel,
      editorOpened: vi.fn()
    })
  )!;
  return { props, saveModels, cancelTestModel, draft };
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

describe("model configuration persistence", () => {
  it("tracks only the requested default while saving and reconciles after success", async () => {
    const { props, draft, saveModels } = setup();
    props.modelSettings = {
      models: [model("existing"), model("alternate")],
      defaultModelId: "existing"
    };
    await nextTick();
    draft.setDefaultModel("alternate");
    props.modelSaving = true;
    await nextTick();
    expect(draft.pendingDefaultModelId.value).toBe("alternate");
    expect(draft.draftDefaultModelId.value).toBe("alternate");
    expect(saveModels.mock.calls[0]![0].defaultModelId).toBe("alternate");
    draft.setDefaultModel("existing");
    expect(saveModels).toHaveBeenCalledOnce();

    props.modelSettings = {
      ...props.modelSettings,
      defaultModelId: "alternate"
    };
    props.modelSaving = false;
    await nextTick();
    expect(draft.pendingDefaultModelId.value).toBeNull();
    expect(draft.draftDefaultModelId.value).toBe("alternate");
    draft.setDefaultModel("alternate");
    expect(saveModels).toHaveBeenCalledOnce();
  });

  it("restores the saved default after failure and allows retry", async () => {
    const { props, draft, saveModels } = setup();
    props.modelSettings = {
      models: [model("existing"), model("alternate")],
      defaultModelId: "existing"
    };
    await nextTick();
    draft.setDefaultModel("alternate");
    props.modelSaving = true;
    await nextTick();
    props.modelError = "保存失败";
    props.modelSaving = false;
    await nextTick();
    expect(draft.pendingDefaultModelId.value).toBeNull();
    expect(draft.draftDefaultModelId.value).toBe("existing");
    draft.setDefaultModel("alternate");
    expect(saveModels).toHaveBeenCalledTimes(2);
  });

  it("saves new models immediately without changing the existing default", () => {
    const { draft, saveModels } = setup();
    draft.saveModelEditor({ model: model("added") });
    expect(saveModels).toHaveBeenCalledOnce();
    expect(saveModels.mock.calls[0]![0]).toMatchObject({
      defaultModelId: "existing",
      models: [{ id: "existing" }, { id: "added" }]
    });
  });

  it("retains the editor on failure, allows retry and closes after persistence", async () => {
    const { props, draft, saveModels } = setup();
    const edited = { ...model("existing"), label: "Updated" };
    draft.editModel(model("existing"));
    draft.saveModelEditor({ originalId: "existing", model: edited });
    props.modelSaving = true;
    await nextTick();
    draft.saveModelEditor({ originalId: "existing", model: edited });
    expect(saveModels).toHaveBeenCalledOnce();
    props.modelError = "保存失败";
    props.modelSaving = false;
    await nextTick();
    expect(draft.modelEditor.value?.id).toBe("existing");
    expect(draft.draftModels.value[0]?.label).toBe("existing");
    draft.saveModelEditor({ originalId: "existing", model: edited });
    expect(saveModels).toHaveBeenCalledTimes(2);
    props.modelSaving = true;
    props.modelError = null;
    await nextTick();
    props.modelSettings = { models: [edited], defaultModelId: edited.id };
    props.modelSaving = false;
    await nextTick();
    expect(draft.modelEditor.value).toBeNull();
    expect(draft.draftModels.value[0]?.label).toBe("Updated");
  });

  it("persists deletion and restores the saved list if deletion fails", async () => {
    const { props, draft, saveModels } = setup();
    draft.removeModel("existing");
    expect(saveModels).toHaveBeenCalledWith({ models: [], defaultModelId: "" });
    props.modelSaving = true;
    await nextTick();
    props.modelError = "保存失败";
    props.modelSaving = false;
    await nextTick();
    expect(draft.draftModels.value.map((entry) => entry.id)).toEqual([
      "existing"
    ]);
  });

  it("saves supportsDeveloperRole=false from advanced settings and clears it when turned off", () => {
    const { draft, saveModels } = setup();
    draft.openAdvancedConfig(model("existing"));
    draft.saveAdvancedConfig({
      contextWindow: 128_000,
      maxTokens: 16_000,
      supportsDeveloperRole: false
    });
    expect(saveModels.mock.calls[0]![0].models[0]).toMatchObject({
      id: "existing",
      contextWindow: 128_000,
      maxTokens: 16_000,
      supportsDeveloperRole: false
    });

    draft.openAdvancedConfig(draft.draftModels.value[0]!);
    draft.saveAdvancedConfig({
      contextWindow: 128_000,
      maxTokens: 16_000
    });
    expect(saveModels.mock.calls[1]![0].models[0]).not.toHaveProperty(
      "supportsDeveloperRole"
    );
  });

  it("auto-persists supportsDeveloperRole=false when a connection test reports fallback", async () => {
    const { draft, saveModels } = setup();
    const settingsStore = useSettingsStore();
    settingsStore.lastModelTestCapacity = {
      modelId: "existing",
      contextWindow: 272_000,
      maxTokens: 128_000,
      supportsDeveloperRole: false
    };
    await nextTick();
    expect(draft.draftModels.value[0]?.supportsDeveloperRole).toBe(false);
    expect(saveModels).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [
          expect.objectContaining({
            id: "existing",
            supportsDeveloperRole: false
          })
        ]
      })
    );
  });

  it("ignores stale capacity results whose configSignature no longer matches and does not disrupt an open editor", async () => {
    const { draft, saveModels } = setup();
    const settingsStore = useSettingsStore();
    draft.openAdvancedConfig(model("existing"));
    settingsStore.lastModelTestCapacity = {
      modelId: "existing",
      contextWindow: 128_000,
      maxTokens: 16_000,
      supportsDeveloperRole: false,
      configSignature: "stale-signature"
    };
    await nextTick();
    expect(draft.draftModels.value[0]?.supportsDeveloperRole).toBeUndefined();
    expect(saveModels).not.toHaveBeenCalled();
  });

  it("silently cancels active tests when deleting a model or closing an unsaved new-model editor", () => {
    const { draft, cancelTestModel } = setup();
    const settingsStore = useSettingsStore();

    draft.createModel("llm");
    const newModelId = draft.modelEditor.value!.id;
    settingsStore.modelTestStates = {
      [newModelId]: {
        modelId: newModelId,
        modelLabel: "New",
        requestId: "req_new",
        configSignature: "sig_new",
        status: "testing",
        message: "正在测试连接…",
        updatedAt: Date.now()
      }
    };
    draft.cancelModelEditor();
    expect(cancelTestModel).toHaveBeenCalledWith(newModelId, { silent: true });

    draft.removeModel("existing");
    expect(cancelTestModel).toHaveBeenCalledWith("existing", { silent: true });
  });
});
