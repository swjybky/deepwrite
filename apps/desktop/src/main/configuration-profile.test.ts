import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultGeneralSettings } from "@deepwrite/contracts";
import {
  resolveConfigurationProfile,
  prepareConfigurationEncryption
} from "./configuration-profile";
import { StorageLocationStore } from "./storage-location-store";
import { GeneralSettingsStore } from "./general-settings-store";
import { ModelConfigStore } from "./model-config-store";
import { ModelConfigPersistence } from "./model-config-persistence";
import { withConfigurationLock } from "./configuration-lock";
import { customModel, emptyCatalog } from "./model-config-store.test-support";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      })
    )
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-configuration-"));
  roots.push(root);
  const installed = join(root, "desktop");
  const development = join(root, "desktop-dev");
  await Promise.all([installed, development].map((path) => mkdir(path)));
  return { root, installed, development };
}

const catalog = {
  initialize: async () => undefined,
  getCatalog: async () => emptyCatalog()
};

describe("shared user configuration", () => {
  it("follows the installed relocation pointer and shares model keys and general settings in both directions", async () => {
    const { root, installed, development } = await fixture();
    const moved = join(root, "moved");
    await mkdir(moved);
    const locations = new StorageLocationStore(installed);
    locations.schedule(moved, false);
    locations.complete();
    const shared = resolveConfigurationProfile(installed, development);
    expect(shared).toBe(await realpath(moved));
    const formal = new ModelConfigStore(moved, { freeModelCatalog: catalog });
    const dev = new ModelConfigStore(shared, { freeModelCatalog: catalog });
    await formal.save({
      models: [{ ...customModel(), apiKey: "invalid-shared-placeholder" }],
      defaultModelId: customModel().id
    });
    await expect(dev.resolve(customModel().id)).resolves.toMatchObject({
      apiKey: "invalid-shared-placeholder",
      baseUrl: "https://example.test/v1"
    });
    await dev.save({
      models: [{ ...customModel(), label: "Changed in development" }],
      defaultModelId: customModel().id
    });
    await expect(formal.resolve(customModel().id)).resolves.toMatchObject({
      apiKey: "invalid-shared-placeholder"
    });
    expect((await formal.list()).models[0]?.label).toBe(
      "Changed in development"
    );
    await new GeneralSettingsStore(shared).save({
      ...createDefaultGeneralSettings(),
      showContextUsage: false
    });
    expect(
      (await new GeneralSettingsStore(moved).list()).settings.showContextUsage
    ).toBe(false);
    await expect(
      readFile(join(development, "config", "models.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      JSON.parse(await readFile(locations.statePath, "utf8")).currentPath
    ).toBe(moved);
  });

  it("keeps explicit profiles independent and refuses to migrate an installed profile", async () => {
    const { installed, development } = await fixture();
    expect(resolveConfigurationProfile(undefined, development)).toBe(
      development
    );
    const locations = new StorageLocationStore(installed);
    locations.schedule(development, false);
    const before = await readFile(locations.statePath, "utf8");
    expect(() => resolveConfigurationProfile(installed, development)).toThrow(
      "先启动正式版"
    );
    expect(await readFile(locations.statePath, "utf8")).toBe(before);
  });

  it("serializes a model refresh against another instance's save and releases the lock after failure", async () => {
    const { installed } = await fixture();
    const settingsPath = join(installed, "config", "models.json");
    const formal = new ModelConfigStore(installed, {
      freeModelCatalog: catalog
    });
    const dev = new ModelConfigStore(installed, { freeModelCatalog: catalog });
    await formal.save({
      models: [{ ...customModel(), apiKey: "invalid-original-placeholder" }],
      defaultModelId: customModel().id
    });
    let refresh!: Promise<unknown>;
    await withConfigurationLock(settingsPath, async () => {
      // Both instances start while a preceding transaction owns the file.
      refresh = Promise.all([
        formal.list(),
        dev.save({
          models: [
            {
              ...customModel(),
              label: "Shared update",
              apiKey: "invalid-updated-placeholder"
            }
          ],
          defaultModelId: customModel().id
        })
      ]);
      expect(
        (await new ModelConfigPersistence(installed).read()).settings.models[0]
          ?.label
      ).toBe(customModel().label);
    });
    await refresh;
    expect((await formal.list()).models[0]?.label).toBe("Shared update");
    await expect(formal.resolve(customModel().id)).resolves.toMatchObject({
      apiKey: "invalid-updated-placeholder"
    });
    await expect(
      withConfigurationLock(settingsPath, async () => {
        throw new Error("test failure");
      })
    ).rejects.toThrow("test failure");
    await expect(dev.list()).resolves.toMatchObject({
      defaultModelId: customModel().id
    });
  });

  it("reuses only Windows encryption material and retains private session preferences", async () => {
    const { installed, development } = await fixture();
    const shared = {
      os_crypt: { encrypted_key: "invalid-encrypted-key-placeholder" },
      privatePreference: "formal"
    };
    await writeFile(join(installed, "Local State"), JSON.stringify(shared));
    await writeFile(
      join(development, "Local State"),
      JSON.stringify({ privatePreference: "development" })
    );
    prepareConfigurationEncryption(installed, development, "win32");
    expect(
      JSON.parse(await readFile(join(development, "Local State"), "utf8"))
    ).toEqual({ os_crypt: shared.os_crypt, privatePreference: "development" });
    expect(
      JSON.parse(await readFile(join(installed, "Local State"), "utf8"))
    ).toEqual(shared);
    prepareConfigurationEncryption(installed, development, "win32");
  });

  it("preserves incompatible private encryption keys and reports missing shared keys", async () => {
    const { installed, development } = await fixture();
    expect(() =>
      prepareConfigurationEncryption(installed, development, "win32")
    ).toThrow("先启动一次正式版");
    await writeFile(
      join(installed, "Local State"),
      JSON.stringify({ os_crypt: { encrypted_key: "invalid-formal-key" } })
    );
    const before = JSON.stringify({
      os_crypt: { encrypted_key: "invalid-private-key" }
    });
    await writeFile(join(development, "Local State"), before);
    expect(() =>
      prepareConfigurationEncryption(installed, development, "win32")
    ).toThrow("另一套加密存储");
    expect(await readFile(join(development, "Local State"), "utf8")).toBe(
      before
    );
    expect(() =>
      prepareConfigurationEncryption(installed, development, "darwin")
    ).not.toThrow();
  });
});
