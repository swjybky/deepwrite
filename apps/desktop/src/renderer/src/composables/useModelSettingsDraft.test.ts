import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftModel } from "../components/modelSettingsDraft";
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
  const scope = effectScope();
  scopes.push(scope);
  const draft = scope.run(() =>
    useModelSettingsDraft(props, {
      saveModels,
      testModel: vi.fn(),
      editorOpened: vi.fn()
    })
  )!;
  return { props, saveModels, draft };
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

describe("model configuration persistence", () => {
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
});
