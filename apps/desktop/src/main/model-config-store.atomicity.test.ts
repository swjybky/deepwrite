import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  fault,
  fixture,
  initialInput,
  newKey,
  newModel,
  oldKey,
  oldModel,
  replacementInput,
  type ModelConfigFaultStage
} from "./model-config-fault.test-support";

const beforeCommit: ModelConfigFaultStage[] = ["write", "sync", "rename"];
const edits = [
  { name: "address and key replacement", input: replacementInput },
  {
    name: "key replacement",
    input: { ...initialInput, models: [{ ...oldModel, apiKey: newKey }] }
  },
  {
    name: "key clearing",
    input: { ...initialInput, models: [{ ...oldModel, clearApiKey: true }] }
  },
  { name: "model deletion", input: { models: [], defaultModelId: "" } }
];

describe("ModelConfigStore atomic configuration commits", () => {
  for (const edit of edits) {
    it.each(beforeCommit)(
      `retains the complete old state if ${edit.name} fails at %s`,
      async (stage) => {
        const context = await fixture();
        const store = context.createStore();
        await store.save(initialInput);
        const previous = await readFile(context.modelsPath, "utf8");
        fault.stage = stage;
        await expect(store.save(edit.input)).rejects.toThrow("Injected");
        expect(await readFile(context.modelsPath, "utf8")).toBe(previous);
        expect(await readdir(context.configDirectory)).toEqual(["models.json"]);
        await expect(
          context.createStore().resolve(oldModel.id)
        ).resolves.toMatchObject({
          baseUrl: oldModel.baseUrl,
          modelId: oldModel.modelId,
          apiKey: oldKey
        });
      }
    );
  }

  it.each<ModelConfigFaultStage>(["after-rename", "directory-sync"])(
    "reloads a complete new state when acknowledgement fails at %s",
    async (stage) => {
      const context = await fixture();
      const store = context.createStore();
      await store.save(initialInput);
      fault.stage = stage;
      await expect(store.save(replacementInput)).rejects.toThrow("Injected");
      // The rename already committed; never roll back just one half of the pair.
      await expect(
        context.createStore().resolve(newModel.id)
      ).resolves.toMatchObject({
        baseUrl: newModel.baseUrl,
        modelId: newModel.modelId,
        apiKey: newKey
      });
    }
  );

  it("serializes a failed save followed by another save without poisoning the queue", async () => {
    const context = await fixture();
    const store = context.createStore();
    await store.save(initialInput);
    fault.stage = "rename";
    const failed = expect(store.save(replacementInput)).rejects.toThrow(
      "Injected"
    );
    const saved = store.save(replacementInput);
    await failed;
    expect((await saved).models[0]?.baseUrl).toBe(newModel.baseUrl);
    await expect(
      context.createStore().resolve(newModel.id)
    ).resolves.toMatchObject({ baseUrl: newModel.baseUrl, apiKey: newKey });
  });

  it("stores encrypted keys with metadata and never exposes either key field publicly", async () => {
    const context = await fixture();
    const saved = await context.createStore().save(replacementInput);
    const disk = await readFile(context.modelsPath, "utf8");
    expect(disk).not.toContain(newKey);
    expect(JSON.parse(disk)).toMatchObject({
      version: 3,
      encryptedApiKeys: { [newModel.id]: expect.any(String) }
    });
    expect(JSON.stringify(saved)).not.toContain("encryptedApiKeys");
    expect(saved.models[0]).not.toHaveProperty("apiKey");
    expect(saved.models[0]?.hasApiKey).toBe(true);
  });

  it.each(["clear", "delete"])(
    "persists %s without restoring a removed key on restart",
    async (operation) => {
      const context = await fixture();
      const store = context.createStore();
      await store.save(initialInput);
      await store.save(
        operation === "delete"
          ? { models: [], defaultModelId: "" }
          : {
              models: [{ ...oldModel, clearApiKey: true }],
              defaultModelId: oldModel.id
            }
      );
      expect(
        (await context.state.read()).secrets.encryptedApiKeys
      ).not.toHaveProperty(oldModel.id);
      const restarted = context.createStore();
      if (operation === "delete")
        expect((await restarted.list()).models).toEqual([]);
      else
        await expect(restarted.resolve(oldModel.id)).resolves.toMatchObject({
          apiKey: ""
        });
    }
  );
});
