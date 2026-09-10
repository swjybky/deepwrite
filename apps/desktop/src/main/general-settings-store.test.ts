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
      permissionMode: "auto-approve" as const,
      autoApproveCrossStageOperations: true,
      autoSave: true,
      language: "zh-CN" as const,
      showInMenuBar: false,
      showContextUsage: false,
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
        showContextUsage: true,
        useNetworkProxy: false,
        workspacePaneLayout: "agent-editor",
        defaultTextViewMode: "edit"
      }
    });
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
