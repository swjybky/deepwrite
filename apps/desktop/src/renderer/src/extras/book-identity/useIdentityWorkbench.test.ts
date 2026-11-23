import { effectScope, nextTick, onMounted, reactive } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BookCoverDesignProfileSchema,
  BookIdentityRecordSchema,
  type ImageModelSettings,
  type ModelConfig
} from "@deepwrite/contracts/renderer";
import { useIdentityWorkbench } from "./useIdentityWorkbench";

// These tests exercise setup state without mounting the page or loading books.
vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  onMounted: vi.fn(),
  onBeforeUnmount: vi.fn()
}));

const model: ModelConfig = {
  id: "model_high",
  label: "Test model",
  provider: "test-provider",
  modelId: "test-model",
  api: "openai-completions",
  baseUrl: "https://example.test/v1",
  reasoning: true,
  defaultThinkingLevel: "high",
  thinkingLevelOptions: ["low", "medium", "high"],
  temperatureOptions: [0.1, 0.7, 1],
  hasApiKey: false
};
const scopes: ReturnType<typeof effectScope>[] = [];
function harness(models: ModelConfig[] = [model], preferredModelId = model.id) {
  const props = reactive({ models, preferredModelId });
  const scope = effectScope();
  scopes.push(scope);
  const workbench = scope.run(() => useIdentityWorkbench(props, vi.fn()))!;
  return { props, workbench };
}
beforeEach(() => {
  vi.mocked(onMounted).mockClear();
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("window", {
    deepwrite: { events: { subscribe: () => vi.fn() } }
  });
});

async function loadImageProfile(
  workbench: ReturnType<typeof useIdentityWorkbench>
) {
  const imageSettings: ImageModelSettings = {
    activeProfileId: "image_test",
    profiles: [
      {
        id: "image_test",
        name: "测试图片模型",
        presetId: "openai-compatible",
        model: "qwen-image-2.0",
        baseUrl: "https://images.example.test/v1",
        defaultAspectRatio: "2:3",
        hasApiKey: true
      }
    ]
  };
  Object.assign(window.deepwrite!, {
    imageModels: { getSettings: async () => imageSettings }
  });
  vi.spyOn(workbench.books, "load").mockResolvedValue();
  vi.spyOn(workbench.profiles, "load").mockResolvedValue();
  vi.mocked(onMounted).mock.calls.at(-1)![0]();
  await nextTick();
}

it("defaults compatible cover models to 3:4 and exposes common ratios", async () => {
  const { workbench } = harness();
  await loadImageProfile(workbench);
  expect(workbench.imageProfile.value?.model).toBe("qwen-image-2.0");
  expect(workbench.ratios.value).toEqual(["3:4", "2:3", "9:16", "1:1", "16:9"]);
  expect(workbench.ratio.value).toBe("3:4");
});

async function coverHarness() {
  const { workbench } = harness();
  const book = { projectType: "short" as const, projectId: "cover_test" };
  const record = BookIdentityRecordSchema.parse({
    schemaVersion: 1,
    kind: "deepwrite.book-identity",
    bookId: book.projectId,
    revision: 0,
    updatedAt: "2026-10-02T00:00:00.000Z",
    adopted: {},
    rounds: []
  });
  const profile = BookCoverDesignProfileSchema.parse({
    id: "default",
    name: "测试档案",
    description: "封面测试",
    systemPrompt: "测试设计方法"
  });
  Object.assign(window.deepwrite!, {
    bookIdentity: { get: async () => record }
  });
  workbench.book.value = book;
  workbench.field.value = "cover";
  workbench.profiles.catalogs.value.cover = [profile];
  await nextTick();
  return workbench;
}

it("sends the selected title rendering mode without overriding the user's choice", async () => {
  const workbench = await coverHarness();
  await loadImageProfile(workbench);
  const start = vi.spyOn(workbench.run, "start").mockResolvedValue();
  for (const titleRendering of ["model", "overlay"] as const) {
    workbench.titleRendering.value = titleRendering;
    await workbench.start();
    expect(start.mock.calls.at(-1)?.[0]).toMatchObject({
      agentId: "book-cover-design",
      input: { aspectRatio: "3:4", titleRendering }
    });
    expect(workbench.titleRendering.value).toBe(titleRendering);
  }
});

it("persists cover ratio and title rendering with the profile defaults", async () => {
  const workbench = await coverHarness();
  const save = vi.spyOn(workbench.profiles, "save").mockResolvedValue();
  workbench.ratio.value = "9:16";
  workbench.titleRendering.value = "overlay";
  workbench.images.value = 2;
  workbench.autoRender.value = false;
  await workbench.setDefault();
  expect(save.mock.calls[0]?.[0][0]).toMatchObject({
    aspectRatio: "9:16",
    titleRendering: "overlay",
    imagesPerCandidate: 2,
    autoRender: false
  });
});
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop();
  vi.unstubAllGlobals();
});

it("starts with the preferred model's configured thinking level", () => {
  const other = { ...model, id: "model_low", defaultThinkingLevel: "low" };
  const { workbench } = harness([other, model]);
  expect(workbench.modelId.value).toBe(model.id);
  expect(workbench.thinkingLevel.value).toBe("high");
});

it("applies each model's default when switching, including temperature mode", () => {
  const low = { ...model, id: "model_low", defaultThinkingLevel: "low" };
  const plain = {
    ...model,
    id: "model_plain",
    reasoning: false,
    defaultThinkingLevel: "off"
  };
  const { workbench } = harness([model, low, plain]);
  workbench.modelId.value = low.id;
  expect(workbench.thinkingLevel.value).toBe("low");
  workbench.modelId.value = plain.id;
  expect(workbench.thinkingLevel.value).toBe("off");
  workbench.modelId.value = model.id;
  expect(workbench.thinkingLevel.value).toBe("high");
});

it("applies the default when model settings arrive after setup", async () => {
  const { props, workbench } = harness([]);
  props.models = [model];
  await nextTick();
  expect(workbench.modelId.value).toBe(model.id);
  expect(workbench.thinkingLevel.value).toBe("high");
});

it.each(["missing", "disabled"])(
  "falls back to an enabled model when the preferred model is %s",
  (preferred) => {
    const { workbench } = harness(
      [{ ...model, id: "disabled", enabled: false }, model],
      preferred
    );
    expect(workbench.modelId.value).toBe(model.id);
    expect(workbench.thinkingLevel.value).toBe("high");
  }
);

it.each(["off", "medium"])(
  "preserves the manual %s selection when settings refresh or tabs change",
  async (level) => {
    const { props, workbench } = harness();
    workbench.thinkingLevel.value = level;
    props.models = [{ ...model }];
    workbench.field.value = "synopsis";
    await nextTick();
    expect(workbench.thinkingLevel.value).toBe(level);
    workbench.field.value = "cover";
    await nextTick();
    expect(workbench.thinkingLevel.value).toBe(level);
  }
);

it("preserves supported levels in temperature mode and falls back when they are removed", async () => {
  const { props, workbench } = harness();
  workbench.thinkingLevel.value = "medium";
  const temperatureModel = {
    ...model,
    reasoning: false,
    defaultThinkingLevel: "off"
  };
  props.models = [temperatureModel];
  await nextTick();
  expect(workbench.thinkingLevel.value).toBe("medium");
  props.models = [{ ...temperatureModel, thinkingLevelOptions: ["high"] }];
  await nextTick();
  expect(workbench.thinkingLevel.value).toBe("off");
});

it("uses the replacement model's default when the selected model is disabled", async () => {
  const low = { ...model, id: "model_low", defaultThinkingLevel: "low" };
  const { props, workbench } = harness([model, low]);
  props.models = [{ ...model, enabled: false }, low];
  await nextTick();
  expect(workbench.modelId.value).toBe(low.id);
  expect(workbench.thinkingLevel.value).toBe("low");
  props.models = [];
  await nextTick();
  expect(workbench.modelId.value).toBe("");
  expect(workbench.thinkingLevel.value).toBe("off");
});
