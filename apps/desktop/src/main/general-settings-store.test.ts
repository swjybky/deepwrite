import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultGeneralSettings } from "@deepwrite/contracts";
import { GeneralSettingsStore } from "./general-settings-store";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

async function createStore(): Promise<{
  root: string;
  store: GeneralSettingsStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-general-settings-"));
  roots.push(root);
  return { root, store: new GeneralSettingsStore(root) };
}

describe("GeneralSettingsStore", () => {
  it("returns safe defaults when no settings have been saved", async () => {
    const { store } = await createStore();
    await expect(store.list()).resolves.toEqual({
      persisted: false,
      settings: createDefaultGeneralSettings()
    });
    expect(createDefaultGeneralSettings()).toMatchObject({
      permissionMode: "auto-approve",
      autoApproveCrossStageOperations: true,
      autoSave: true,
      showContextUsage: true,
      useNetworkProxy: false,
      defaultTextViewMode: "edit"
    });
  });

  it("persists all general preferences including the workspace layout", async () => {
    const { root, store } = await createStore();
    const settings = {
      ...createDefaultGeneralSettings(),
      permissionMode: "auto-approve" as const,
      autoApproveCrossStageOperations: true,
      autoSave: true,
      language: "en-US" as const,
      showInMenuBar: false,
      showContextUsage: false,
      textAttachmentMaxCharacters: 150_000,
      contextCompaction: {
        ...createDefaultGeneralSettings().contextCompaction,
        budgetTokens: 256_000
      },
      useNetworkProxy: true,
      workspacePaneLayout: "editor-agent" as const,
      defaultTextViewMode: "preview" as const
    };

    await expect(store.save(settings)).resolves.toEqual({
      persisted: true,
      settings
    });
    await expect(store.list()).resolves.toEqual({
      persisted: true,
      settings
    });
    expect(
      JSON.parse(
        await readFile(join(root, "config", "general-settings.json"), "utf8")
      )
    ).toEqual({ version: 2, ...settings });
  });

  it("defaults the manual compaction button to hidden for older settings and saves its choice", async () => {
    const { root, store } = await createStore();
    const settings = createDefaultGeneralSettings();
    const { showManualButton: _, ...legacyCompaction } =
      settings.contextCompaction;
    await mkdir(join(root, "config"));
    await writeFile(
      store.settingsPath,
      JSON.stringify({
        version: 2,
        ...settings,
        contextCompaction: legacyCompaction
      })
    );

    const loaded = await store.list();
    expect(loaded.settings.contextCompaction.showManualButton).toBe(false);
    const updated = {
      ...loaded.settings,
      contextCompaction: {
        ...loaded.settings.contextCompaction,
        showManualButton: true
      }
    };
    await store.save(updated);
    expect(
      (await new GeneralSettingsStore(root).list()).settings.contextCompaction
        .showManualButton
    ).toBe(true);
  });

  it("gives older settings the original text attachment cutoff", async () => {
    const { root, store } = await createStore();
    const { textAttachmentMaxCharacters: _, ...legacy } =
      createDefaultGeneralSettings();
    await mkdir(join(root, "config"));
    await writeFile(
      store.settingsPath,
      JSON.stringify({ version: 2, ...legacy })
    );

    expect((await store.list()).settings.textAttachmentMaxCharacters).toBe(
      100_000
    );
  });

  it("clamps saved and previously persisted attachment cutoffs to the working budget", async () => {
    const { root, store } = await createStore();
    const settings = {
      ...createDefaultGeneralSettings(),
      textAttachmentMaxCharacters: 200_000,
      contextCompaction: {
        ...createDefaultGeneralSettings().contextCompaction,
        budgetTokens: 64_000
      }
    };
    await mkdir(join(root, "config"));
    await writeFile(
      store.settingsPath,
      JSON.stringify({ version: 2, ...settings })
    );

    expect((await store.list()).settings.textAttachmentMaxCharacters).toBe(
      57_600
    );
    expect(
      (await store.save(settings)).settings.textAttachmentMaxCharacters
    ).toBe(57_600);
    expect(
      (await new GeneralSettingsStore(root).list()).settings
        .textAttachmentMaxCharacters
    ).toBe(57_600);
  });

  it("preserves older view preferences and persists independent body formats across restart", async () => {
    const { root, store } = await createStore();
    const { bodyTextFormats: _, ...legacy } = createDefaultGeneralSettings();
    await mkdir(join(root, "config"));
    await writeFile(
      store.settingsPath,
      JSON.stringify({ version: 2, ...legacy, defaultTextViewMode: "preview" })
    );
    const loaded = await store.list();
    expect(loaded.settings.defaultTextViewMode).toBe("preview");
    expect(loaded.settings.bodyTextFormats).toEqual(
      createDefaultGeneralSettings().bodyTextFormats
    );
    const settings = {
      ...loaded.settings,
      bodyTextFormats: {
        short: "indent-compact" as const,
        script: "flush-compact" as const,
        long: "indent-spaced" as const
      }
    };
    await store.save(settings);
    expect((await new GeneralSettingsStore(root).list()).settings).toEqual(
      settings
    );
  });

  it("migrates v1 approval defaults without discarding other preferences", async () => {
    const { root, store } = await createStore();
    const configDirectory = join(root, "config");
    await mkdir(configDirectory);
    await writeFile(
      join(configDirectory, "general-settings.json"),
      JSON.stringify({
        version: 1,
        permissionMode: "request-approval",
        autoSave: false,
        language: "zh-CN",
        showInMenuBar: false
      })
    );

    await expect(store.list()).resolves.toEqual({
      persisted: true,
      settings: {
        permissionMode: "auto-approve",
        autoApproveCrossStageOperations: true,
        autoSave: false,
        language: "zh-CN",
        showInMenuBar: false,
        taskNotification: false,
        showContextUsage: true,
        textAttachmentMaxCharacters: 100_000,
        contextCompaction: createDefaultGeneralSettings().contextCompaction,
        useNetworkProxy: false,
        workspacePaneLayout: "agent-editor",
        defaultTextViewMode: "edit",
        bodyTextFormats: createDefaultGeneralSettings().bodyTextFormats,
        moreFeatures: createDefaultGeneralSettings().moreFeatures
      }
    });
  });

  it("keeps task notifications off for older files and persists the choice", async () => {
    const { root, store } = await createStore();
    const file = join(root, "config", "general-settings.json");
    await mkdir(join(root, "config"));
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        permissionMode: "auto-approve",
        autoSave: true,
        language: "auto",
        showInMenuBar: true
      })
    );
    const legacy = await store.list();
    expect(legacy.persisted).toBe(true);
    expect(legacy.settings.taskNotification).toBe(false);

    await store.save({ ...legacy.settings, taskNotification: true });
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
      version: 2,
      taskNotification: true
    });
    await expect(new GeneralSettingsStore(root).list()).resolves.toMatchObject({
      persisted: true,
      settings: { taskNotification: true }
    });
  });

  it("preserves existing preferences when adding more features defaults and persists visibility and order across restart", async () => {
    const { root, store } = await createStore();
    const { moreFeatures: _, ...legacy } = createDefaultGeneralSettings();
    await mkdir(join(root, "config"));
    await writeFile(
      store.settingsPath,
      JSON.stringify({
        version: 2,
        ...legacy,
        autoSave: false,
        language: "en-US"
      })
    );
    const loaded = await store.list();
    expect(loaded.persisted).toBe(true);
    expect(loaded.settings).toMatchObject({
      autoSave: false,
      language: "en-US",
      moreFeatures: createDefaultGeneralSettings().moreFeatures
    });
    const updated = {
      ...loaded.settings,
      moreFeatures: [...loaded.settings.moreFeatures]
        .reverse()
        .map((entry) => ({ ...entry, visible: entry.id !== "chat-assistant" }))
    };
    await store.save(updated);
    expect((await new GeneralSettingsStore(root).list()).settings).toEqual(
      updated
    );
  });

  it("enables explicitly disabled legacy approvals only once", async () => {
    const { root, store } = await createStore();
    const settings = {
      ...createDefaultGeneralSettings(),
      permissionMode: "request-approval" as const,
      autoApproveCrossStageOperations: false,
      autoSave: false,
      workspacePaneLayout: "editor-agent" as const
    };
    await mkdir(join(root, "config"));
    await writeFile(
      store.settingsPath,
      JSON.stringify({ version: 1, ...settings })
    );

    const migrated = {
      ...settings,
      permissionMode: "auto-approve",
      autoApproveCrossStageOperations: true
    };
    await expect(store.list()).resolves.toEqual({
      persisted: true,
      settings: migrated
    });
    expect(JSON.parse(await readFile(store.settingsPath, "utf8"))).toEqual({
      version: 2,
      ...migrated
    });

    await store.save(settings);
    await expect(new GeneralSettingsStore(root).list()).resolves.toEqual({
      persisted: true,
      settings
    });
  });

  it("preserves a save queued while legacy settings are being read", async () => {
    const { root, store } = await createStore();
    await mkdir(join(root, "config"));
    await writeFile(
      store.settingsPath,
      JSON.stringify({ version: 1, ...createDefaultGeneralSettings() })
    );
    const settings = {
      ...createDefaultGeneralSettings(),
      permissionMode: "request-approval" as const,
      autoApproveCrossStageOperations: false
    };

    await Promise.all([store.list(), store.save(settings)]);
    await expect(new GeneralSettingsStore(root).list()).resolves.toEqual({
      persisted: true,
      settings
    });
  });

  it("falls back safely when the disk settings are malformed", async () => {
    const { root, store } = await createStore();
    const configDirectory = join(root, "config");
    await mkdir(configDirectory);
    await writeFile(
      join(configDirectory, "general-settings.json"),
      JSON.stringify({
        version: 1,
        permissionMode: "unsafe",
        autoSave: "yes",
        language: "unknown",
        showInMenuBar: true,
        defaultTextViewMode: "reader"
      })
    );

    await expect(store.list()).resolves.toEqual({
      persisted: false,
      settings: createDefaultGeneralSettings()
    });
  });

  it("migrates the removed full-access option to auto approval", async () => {
    const { root, store } = await createStore();
    const configDirectory = join(root, "config");
    await mkdir(configDirectory);
    await writeFile(
      join(configDirectory, "general-settings.json"),
      JSON.stringify({
        version: 1,
        permissionMode: "full-access",
        autoSave: false,
        language: "auto",
        showInMenuBar: true
      })
    );

    await expect(store.list()).resolves.toEqual({
      persisted: true,
      settings: {
        ...createDefaultGeneralSettings(),
        permissionMode: "auto-approve",
        autoSave: false
      }
    });
  });
});
