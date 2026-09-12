import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fault,
  fixture,
  initialInput,
  newKey,
  oldKey,
  oldModel,
  replacementInput,
  writeLegacy,
  type ModelConfigFaultStage
} from "./model-config-fault.test-support";

describe("Model configuration V3 migration and restart", () => {
  it.each([1, 2])(
    "migrates legacy v%s metadata and encrypted secrets without changing the pair",
    async (version) => {
      const context = await fixture();
      await writeLegacy(context, version);
      await expect(
        context.createStore().resolve(oldModel.id)
      ).resolves.toMatchObject({ baseUrl: oldModel.baseUrl, apiKey: oldKey });
      expect(
        JSON.parse(await readFile(context.modelsPath, "utf8")).version
      ).toBe(3);
      await expect(readFile(context.secretsPath, "utf8")).rejects.toMatchObject(
        { code: "ENOENT" }
      );
      await expect(
        context.createStore().resolve(oldModel.id)
      ).resolves.toMatchObject({ apiKey: oldKey });
    }
  );

  it.each<ModelConfigFaultStage>(["write", "sync", "rename"])(
    "preserves both legacy files if migration fails at %s",
    async (stage) => {
      const context = await fixture();
      await writeLegacy(context);
      const before = await Promise.all([
        readFile(context.modelsPath, "utf8"),
        readFile(context.secretsPath, "utf8")
      ]);
      fault.stage = stage;
      await expect(
        context.createStore().save(replacementInput)
      ).rejects.toThrow("Injected");
      expect(
        await Promise.all([
          readFile(context.modelsPath, "utf8"),
          readFile(context.secretsPath, "utf8")
        ])
      ).toEqual(before);
      await expect(
        context.createStore().resolve(oldModel.id)
      ).resolves.toMatchObject({ baseUrl: oldModel.baseUrl, apiKey: oldKey });
    }
  );

  it("ignores leftover old secrets when interrupted after committing the new state", async () => {
    const context = await fixture();
    await writeLegacy(context);
    fault.stage = "after-rename";
    await expect(context.createStore().save(replacementInput)).rejects.toThrow(
      "Injected"
    );
    expect(
      JSON.parse(await readFile(context.secretsPath, "utf8")).encryptedApiKeys[
        oldModel.id
      ]
    ).toBe(Buffer.from(oldKey).toString("base64"));
    await expect(
      context.createStore().resolve(oldModel.id)
    ).resolves.toMatchObject({
      baseUrl: replacementInput.models[0]!.baseUrl,
      apiKey: newKey
    });
  });

  it("does not report save failure when removing an obsolete secrets file fails", async () => {
    const context = await fixture();
    await writeLegacy(context);
    fault.stage = "legacy-cleanup";
    await context.createStore().save(replacementInput);
    expect(await readFile(context.secretsPath, "utf8")).toBeTruthy();
    await expect(
      context.createStore().resolve(oldModel.id)
    ).resolves.toMatchObject({ apiKey: newKey });
  });

  it("never revives old secrets for a V3 model whose key was cleared", async () => {
    const context = await fixture();
    const store = context.createStore();
    await store.save(initialInput);
    await store.save({
      models: [{ ...oldModel, clearApiKey: true }],
      defaultModelId: oldModel.id
    });
    await writeFile(
      context.secretsPath,
      JSON.stringify({
        version: 1,
        encryptedApiKeys: {
          [oldModel.id]: Buffer.from(oldKey).toString("base64")
        }
      })
    );
    await expect(
      context.createStore().resolve(oldModel.id)
    ).resolves.toMatchObject({ apiKey: "" });
  });

  it("ignores an unfinished temporary generation after a process restart", async () => {
    const context = await fixture();
    await context.createStore().save(initialInput);
    await writeFile(
      join(context.configDirectory, ".models-interrupted.tmp"),
      '{"version":3,'
    );
    await expect(
      context.createStore().resolve(oldModel.id)
    ).resolves.toMatchObject({ baseUrl: oldModel.baseUrl, apiKey: oldKey });
  });

  it.each([
    "invalid JSON",
    JSON.stringify({ version: 3, models: [oldModel] }),
    JSON.stringify({ version: 4 })
  ])(
    "fails closed instead of importing legacy secrets for unreadable current state: %s",
    async (data) => {
      const context = await fixture();
      await writeLegacy(context);
      await writeFile(context.modelsPath, data);
      await expect(context.createStore().resolve(oldModel.id)).rejects.toThrow(
        /配置/
      );
      expect(await readFile(context.modelsPath, "utf8")).toBe(data);
    }
  );
});
