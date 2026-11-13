import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createDefaultGeneralSettings,
  type GeneralSettings
} from "@deepwrite/contracts";
import { GeneralSettingsStore } from "./general-settings-store";
import { handleSettingsCommands } from "./ipc/settings-commands";
import type { IpcCommandContext } from "./ipc/command-types";

vi.mock("../preload/invoke", () => ({
  browserId: (prefix: string) => `${prefix}_test`,
  invokeCommand: vi.fn()
}));
import { invokeCommand } from "../preload/invoke";
import {
  listGeneralSettings,
  saveGeneralSettings
} from "../preload/settings-api";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
  vi.mocked(invokeCommand).mockReset();
});

describe("more features general settings IPC", () => {
  it("round trips visibility and order through Preload validation, Main routing and disk, including restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepwrite-more-features-ipc-"));
    roots.push(root);
    let store = new GeneralSettingsStore(root);
    const syncGeneralSettings = vi.fn();
    const context = {
      requireGeneralSettingsStore: () => store,
      syncGeneralSettings
    } as unknown as IpcCommandContext;
    vi.mocked(invokeCommand).mockImplementation(async (raw) => {
      const command = CommandEnvelopeSchema.parse(
        JSON.parse(JSON.stringify(raw))
      );
      const result = await handleSettingsCommands(context, command);
      if (!result || result.status !== "accepted")
        throw new Error("settings command rejected");
      return JSON.parse(JSON.stringify(result.payload));
    });
    const defaults = await listGeneralSettings();
    expect(defaults.settings.moreFeatures).toEqual(
      createDefaultGeneralSettings().moreFeatures
    );
    const settings = {
      ...defaults.settings,
      versionHistoryEnabled: true,
      moreFeatures: [...defaults.settings.moreFeatures]
        .reverse()
        .map((entry) => ({ ...entry, visible: entry.id !== "chat-assistant" }))
    };
    await expect(saveGeneralSettings(settings)).resolves.toEqual({
      persisted: true,
      settings
    });
    expect(syncGeneralSettings).toHaveBeenLastCalledWith(settings);
    store = new GeneralSettingsStore(root);
    expect((await listGeneralSettings()).settings).toEqual(settings);
    const callsBefore = vi.mocked(invokeCommand).mock.calls.length;
    await expect(
      saveGeneralSettings({
        ...settings,
        moreFeatures: [{ id: "arbitrary-feature", visible: true }]
      } as unknown as GeneralSettings)
    ).rejects.toThrow();
    expect(vi.mocked(invokeCommand).mock.calls).toHaveLength(callsBefore);
    expect((await store.list()).settings).toEqual(settings);
  });
});
