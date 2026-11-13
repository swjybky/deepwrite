import { describe, expect, it } from "vitest";
import type { ModelConfig } from "@deepwrite/contracts";
import {
  createDeepWriteSiteOfficialModels,
  saveDeepWriteSiteOfficialModelInput
} from "./deepwrite-site-official-model-config";
import { parseRemoteModelList } from "./remote-model-list-parser";

const gateway = "https://gateway.example.test";

function publicCatalog(sort: unknown) {
  return {
    models: parseRemoteModelList({
      object: "list",
      data: [
        {
          id: "z-writer",
          label: "Writer Fixture",
          description: "Writer description",
          api: "openai-completions",
          sort,
          input: 1.25,
          output: 2.5,
          cache: 0.25
        },
        {
          id: "a-native",
          label: "Native Fixture",
          description: "Native description",
          api: "google-generative-ai",
          sort: Number.MAX_SAFE_INTEGER,
          input: 2,
          output: 4,
          cache: 0.5
        }
      ]
    }),
    googleModels: parseRemoteModelList({
      models: [
        {
          name: "models/a-native",
          displayName: "Native Fixture",
          description: "Native description",
          api: "google-generative-ai",
          sort: Number.MAX_SAFE_INTEGER,
          input: 2,
          output: 4,
          cache: 0.5
        }
      ]
    })
  };
}

describe("additive official sort metadata compatibility", () => {
  it.each([0, Number.MAX_SAFE_INTEGER, -1, 1.5, "1", null, Infinity])(
    "keeps OpenAI and Google model identities and display fields with sort %s",
    (sort) => {
      const catalog = publicCatalog(sort);
      expect(catalog.models).toHaveLength(2);
      expect(catalog.googleModels).toHaveLength(1);
      const models = createDeepWriteSiteOfficialModels(
        "invalid-test-key",
        catalog,
        gateway
      );
      expect(models).toHaveLength(2);
      expect(
        models.find((model) => model.modelId === "z-writer")
      ).toMatchObject({
        modelId: "z-writer",
        label: "Writer Fixture",
        description: "Writer description",
        api: "openai-completions",
        input: 1.25,
        output: 2.5,
        cache: 0.25
      });
      expect(
        models.find((model) => model.modelId === "a-native")
      ).toMatchObject({
        modelId: "a-native",
        label: "Native Fixture",
        description: "Native description",
        api: "google-generative-ai",
        input: 2,
        output: 4,
        cache: 0.5
      });
    }
  );
});

describe("official model display order", () => {
  it.each([-1, 1.5, "1", null, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "ignores invalid sort metadata %s without losing the model",
    (sort) => {
      expect(parseRemoteModelList({ data: [{ id: "writer", sort }] })).toEqual([
        { id: "writer" }
      ]);
    }
  );

  it.each([0, Number.MAX_SAFE_INTEGER])(
    "accepts safe sort boundary %s",
    (sort) => {
      expect(parseRemoteModelList({ data: [{ id: "writer", sort }] })).toEqual([
        { id: "writer", sort }
      ]);
    }
  );

  it("keeps custom discovery alphabetic while retaining official sort metadata", () => {
    expect(
      parseRemoteModelList({
        data: [
          { id: "z-writer", sort: 0 },
          { id: "a-writer", sort: 20 }
        ]
      })
    ).toEqual([
      { id: "a-writer", sort: 20 },
      { id: "z-writer", sort: 0 }
    ]);
  });

  it("orders the merged official catalog by sort and then model id", () => {
    const models = createDeepWriteSiteOfficialModels(
      "invalid-test-key",
      {
        models: parseRemoteModelList({
          data: [
            { id: "a-writer", sort: 20 },
            { id: "z-writer", sort: 0 },
            { id: "b-writer", sort: 20 }
          ]
        }),
        googleModels: parseRemoteModelList({
          models: [{ name: "models/gemini-fixture", sort: 10 }]
        })
      },
      gateway
    );
    expect(models.map((model) => model.modelId)).toEqual([
      "z-writer",
      "gemini-fixture",
      "a-writer",
      "b-writer"
    ]);
    expect(models[1]?.api).toBe("google-generative-ai");
  });

  it("preserves the previous merged order when an older server omits sort", () => {
    const models = createDeepWriteSiteOfficialModels(
      "invalid-test-key",
      {
        models: parseRemoteModelList({ data: ["z-writer", "a-writer"] }),
        googleModels: [{ id: "gemini-fixture" }]
      },
      gateway
    );
    expect(models.map((model) => model.modelId)).toEqual([
      "a-writer",
      "z-writer",
      "gemini-fixture"
    ]);
  });

  it("matches gateway case, punctuation and Unicode order for equal sort values", () => {
    const models = createDeepWriteSiteOfficialModels(
      "invalid-test-key",
      {
        models: parseRemoteModelList({
          data: [
            "a2",
            "a_",
            "a.",
            "a-",
            "a10",
            "a",
            "A",
            "writer-\u{10000}",
            "writer-\uE000"
          ].map((id) => ({ id, sort: 0 }))
        }),
        googleModels: []
      },
      gateway
    );
    expect(models.map((model) => model.modelId)).toEqual([
      "A",
      "a",
      "a-",
      "a.",
      "a10",
      "a2",
      "a_",
      "writer-\uE000",
      "writer-\u{10000}"
    ]);
  });

  it("uses Google sort metadata and defaults a missing sort to zero", () => {
    const models = createDeepWriteSiteOfficialModels(
      "invalid-test-key",
      {
        models: [
          { id: "a-writer", sort: 10 },
          { id: "gemini-fixture" },
          { id: "z-writer" }
        ],
        googleModels: [{ id: "gemini-fixture", sort: 5 }]
      },
      gateway
    );
    expect(models.map((model) => model.modelId)).toEqual([
      "z-writer",
      "gemini-fixture",
      "a-writer"
    ]);
  });

  it("refreshes the saved order while keeping visibility and the selected default", () => {
    const initial = createDeepWriteSiteOfficialModels(
      "invalid-test-key",
      {
        models: [
          { id: "a-writer", sort: 0 },
          { id: "z-writer", sort: 10 }
        ],
        googleModels: []
      },
      gateway
    );
    const models: ModelConfig[] = initial.map(({ apiKey: _key, ...model }) => ({
      ...model,
      hasApiKey: true,
      enabled: model.modelId !== "z-writer"
    }));
    const defaultModelId = models[0]!.id;
    const refreshed = saveDeepWriteSiteOfficialModelInput(
      { models, defaultModelId },
      "invalid-test-key",
      {
        models: [
          { id: "a-writer", sort: 10 },
          { id: "z-writer", sort: 0 }
        ],
        googleModels: []
      },
      gateway
    );
    expect(refreshed.models.map((model) => model.modelId)).toEqual([
      "z-writer",
      "a-writer"
    ]);
    expect(refreshed.models[0]?.enabled).toBe(false);
    expect(refreshed.defaultModelId).toBe(defaultModelId);
  });
});
