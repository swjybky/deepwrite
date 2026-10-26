import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImagePersistence } from "./image-persistence";
import {
  imageSettingsInput,
  INVALID_IMAGE_KEY,
  testSecureStorage
} from "./image-test-support";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-image-persistence-"));
  roots.push(root);
  return { root, store: new ImagePersistence(root, testSecureStorage) };
}

describe("ImagePersistence", () => {
  it("encrypts keys, fills IDs and selects the first configured profile", async () => {
    const { root, store } = await setup();
    const input = imageSettingsInput();
    delete input.profiles[0]!.id;
    input.activeProfileId = null;
    const settings = await store.saveSettings(input);
    expect(settings.activeProfileId).toMatch(/^img_/u);
    expect(settings.profiles[0]).not.toHaveProperty("apiKey");
    expect(
      await readFile(join(root, "config/image-models.json"), "utf8")
    ).not.toContain(INVALID_IMAGE_KEY);
    expect((await store.resolve()).apiKey).toBe(INVALID_IMAGE_KEY);
    const reopened = new ImagePersistence(root, testSecureStorage);
    expect(await reopened.getSettings()).toEqual(settings);
  });

  it("preserves blank keys, removes deleted secrets and changes active profile", async () => {
    const { root, store } = await setup();
    const input = imageSettingsInput();
    input.profiles.push({ ...input.profiles[0]!, id: "img_second" });
    await store.saveSettings(input);
    delete input.profiles[0]!.apiKey;
    await store.saveSettings(input);
    expect((await store.resolve("img_test")).apiKey).toBe(INVALID_IMAGE_KEY);
    input.profiles.shift();
    const settings = await store.saveSettings(input);
    expect(settings.activeProfileId).toBe("img_second");
    const raw = JSON.parse(
      await readFile(join(root, "config/image-models.json"), "utf8")
    );
    expect(raw.encryptedApiKeys).not.toHaveProperty("img_test");
    input.profiles[0]!.clearApiKey = true;
    expect((await store.saveSettings(input)).activeProfileId).toBeNull();
  });

  it("never stores a key if system encryption is unavailable", async () => {
    const { root } = await setup();
    const store = new ImagePersistence(root, {
      ...testSecureStorage,
      isEncryptionAvailable: () => false
    });
    await expect(store.saveSettings(imageSettingsInput())).rejects.toThrow(
      "安全存储不可用"
    );
    expect((await store.getSettings()).profiles).toEqual([]);
  });

  it("keeps the encrypted key when an existing configuration switches to MiniMax", async () => {
    const { root, store } = await setup();
    const settings = await store.saveSettings(imageSettingsInput());
    const { hasApiKey: _key, ...profile } = settings.profiles[0]!;
    await store.saveSettings({
      activeProfileId: settings.activeProfileId,
      profiles: [{ ...profile, presetId: "minimax-image", model: "image-01" }]
    });
    const reopened = new ImagePersistence(root, testSecureStorage);
    expect(await reopened.resolve()).toMatchObject({
      id: profile.id,
      presetId: "minimax-image",
      model: "image-01",
      apiKey: INVALID_IMAGE_KEY
    });
    expect((await reopened.getSettings()).profiles[0]).not.toHaveProperty(
      "apiKey"
    );
  });

  it("serializes concurrent usage and retains the latest 100 privacy-safe entries", async () => {
    const { store } = await setup();
    await Promise.all(
      Array.from({ length: 105 }, (_, index) =>
        store.appendUsage({
          requestId: `usage_${index}`,
          profileId: "img_test",
          model: "invalid-test-image-model",
          images: 1,
          size: "600x800",
          durationMs: 10,
          status: "success",
          createdAt: "2026-10-02T12:00:00.000Z"
        })
      )
    );
    const usage = await store.getUsage();
    expect(usage).toHaveLength(100);
    expect(usage[0]!.requestId).toBe("usage_5");
    expect(usage.at(-1)!.requestId).toBe("usage_104");
    expect(usage[0]).not.toHaveProperty("prompt");
  });
});
