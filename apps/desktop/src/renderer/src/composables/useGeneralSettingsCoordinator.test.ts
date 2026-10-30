import {
  createDefaultGeneralSettings,
  type GeneralSettings
} from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  deferred,
  harness,
  storage
} from "./generalSettingsCoordinator.test-support";

describe("general settings coordinator", () => {
  it("caps the attachment cutoff when the working budget is lowered", async () => {
    const { coordinator, settings, api } = harness();
    coordinator.updateTextAttachmentMaxCharacters(200_000);
    expect(settings.value.textAttachmentMaxCharacters).toBe(144_000);
    coordinator.updateContextCompaction({
      ...settings.value.contextCompaction,
      budgetTokens: 64_000
    });
    expect(settings.value.textAttachmentMaxCharacters).toBe(57_600);
    await coordinator.drain();
    expect(api!.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ textAttachmentMaxCharacters: 57_600 })
    );
  });

  it("saves the task notification choice with the other preferences", async () => {
    const test = harness();
    test.coordinator.updateTaskNotification(true);
    expect(test.settings.value.taskNotification).toBe(true);
    await test.coordinator.drain();
    expect(test.api!.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskNotification: true })
    );
  });

  it("blocks strict close after an unsuccessful save and retries the same preferences", async () => {
    const test = harness();
    const save = vi.mocked(test.api!.save);
    save.mockRejectedValue(new Error("disk unavailable"));
    test.coordinator.updateShowInMenuBar(true);
    await expect(test.coordinator.drain({ strict: true })).rejects.toThrow(
      "尚未保存"
    );
    save.mockResolvedValue({ persisted: true, settings: test.settings.value });
    await expect(
      test.coordinator.drain({ strict: true })
    ).resolves.toBeUndefined();
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ showInMenuBar: true })
    );
  });

  it("waits for settings queued behind an earlier in-flight save", async () => {
    const test = harness();
    const pending = deferred<{
      persisted: boolean;
      settings: GeneralSettings;
    }>();
    const save = vi.mocked(test.api!.save);
    save.mockImplementationOnce(() => pending.promise);
    test.coordinator.updateShowInMenuBar(true);
    let complete = false;
    const closing = test.coordinator.drain({ strict: true }).then(() => {
      complete = true;
    });
    test.coordinator.updateUseNetworkProxy(true);
    await Promise.resolve();
    expect(complete).toBe(false);
    pending.resolve({ persisted: true, settings: test.settings.value });
    await closing;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ useNetworkProxy: true })
    );
  });

  it("keeps the selected language active when persistence fails and serializes subsequent changes", async () => {
    const api = {
      list: vi.fn(async () => ({
        persisted: true,
        settings: createDefaultGeneralSettings()
      })),
      save: vi
        .fn()
        .mockRejectedValueOnce(new Error("disk unavailable"))
        .mockResolvedValue({
          persisted: true,
          settings: createDefaultGeneralSettings()
        })
    };
    const { coordinator, settings, root, warning } = harness({ api });
    await coordinator.load();
    coordinator.updateLanguage("en-US");
    expect(root.lang).toBe("en-US");
    expect(settings.value.language).toBe("en-US");
    await coordinator.drain();
    expect(warning).toHaveBeenCalledWith(
      "General settings are active for this session, but could not be saved locally: disk unavailable"
    );
    coordinator.updateLanguage("zh-CN");
    await coordinator.drain();
    expect(root.lang).toBe("zh-CN");
    expect(api.save.mock.calls.map(([settings]) => settings.language)).toEqual([
      "en-US",
      "zh-CN"
    ]);
  });
  it("merges edited body kinds over persisted choices during initial loading", async () => {
    const pending = deferred<{
      persisted: boolean;
      settings: GeneralSettings;
    }>();
    const api = {
      list: vi.fn(() => pending.promise),
      save: vi.fn(async (settings: GeneralSettings) => ({
        persisted: true,
        settings
      }))
    };
    const { coordinator, settings } = harness({ api });
    const loading = coordinator.load();
    coordinator.updateBodyTextFormat({
      kind: "short",
      format: "indent-compact"
    });
    pending.resolve({
      persisted: true,
      settings: {
        ...createDefaultGeneralSettings(),
        defaultTextViewMode: "preview",
        bodyTextFormats: {
          short: "flush-compact",
          script: "indent-spaced",
          long: "indent-compact"
        }
      }
    });
    await loading;
    await coordinator.drain();
    expect(settings.value.bodyTextFormats).toEqual({
      short: "indent-compact",
      script: "indent-spaced",
      long: "indent-compact"
    });
    expect(settings.value.defaultTextViewMode).toBe("preview");
    expect(api.save).toHaveBeenCalledWith(settings.value);
    coordinator.updateBodyTextFormat({ kind: "long", format: "flush-compact" });
    await coordinator.drain();
    expect(api.save.mock.calls[0]![0].bodyTextFormats.long).toBe(
      "indent-compact"
    );
    expect(settings.value.bodyTextFormats.long).toBe("flush-compact");
  });

  it("applies local defaults when the desktop API is unavailable", async () => {
    const { coordinator, applyApprovalMode, root } = harness({ api: null });
    await coordinator.load();

    expect(root).toMatchObject({
      lang: "zh-CN",
      dataset: { appLanguage: "auto" }
    });
    expect(applyApprovalMode).toHaveBeenCalledWith("auto-approve");
  });

  it("migrates an enabled legacy auto-save preference exactly once", async () => {
    const api = {
      list: vi.fn(async () => ({
        persisted: false,
        settings: { ...createDefaultGeneralSettings(), autoSave: false }
      })),
      save: vi.fn(async () => ({
        persisted: true,
        settings: createDefaultGeneralSettings()
      }))
    };
    const { coordinator, settings } = harness({ api, legacyAutoSave: true });

    await coordinator.load();
    await coordinator.drain();

    expect(settings.value.autoSave).toBe(true);
    expect(api.save).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ autoSave: true })
    );
  });

  it("serializes immutable setting snapshots", async () => {
    const snapshots: GeneralSettings[] = [];
    const api = {
      list: vi.fn(),
      save: vi.fn(async (value: GeneralSettings) => {
        snapshots.push(value);
        return { persisted: true, settings: value };
      })
    };
    const { coordinator } = harness({ api });

    coordinator.updateLanguage("zh-CN");
    coordinator.updateShowInMenuBar(false);
    coordinator.updateUseNetworkProxy(true);
    coordinator.updateWorkspacePaneLayout("editor-agent");
    coordinator.updateDefaultTextViewMode("preview");
    await coordinator.drain();

    expect(snapshots).toHaveLength(5);
    expect(snapshots[0]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: true
    });
    expect(snapshots[1]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: false
    });
    expect(snapshots[2]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: false,
      useNetworkProxy: true
    });
    expect(snapshots[3]).toMatchObject({
      language: "zh-CN",
      showInMenuBar: false,
      workspacePaneLayout: "editor-agent"
    });
    expect(snapshots[4]).toMatchObject({
      workspacePaneLayout: "editor-agent",
      defaultTextViewMode: "preview"
    });
  });

  it("merges updates made while the initial settings read is pending", async () => {
    const pending = deferred<{
      persisted: boolean;
      settings: GeneralSettings;
    }>();
    const api = {
      list: vi.fn(() => pending.promise),
      save: vi.fn(async (value: GeneralSettings) => ({
        persisted: true,
        settings: value
      }))
    };
    const { coordinator, publishLoaded, settings } = harness({ api });

    const loading = coordinator.load();
    coordinator.updateLanguage("zh-CN");
    coordinator.updateShowInMenuBar(false);
    expect(api.save).not.toHaveBeenCalled();

    pending.resolve({
      persisted: true,
      settings: {
        ...createDefaultGeneralSettings(),
        permissionMode: "request-approval",
        autoSave: false,
        language: "auto",
        showInMenuBar: true
      }
    });
    await loading;
    await coordinator.drain();

    expect(settings.value).toEqual({
      ...createDefaultGeneralSettings(),
      permissionMode: "request-approval",
      autoSave: false,
      language: "zh-CN",
      showInMenuBar: false
    });
    expect(api.save).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledWith(settings.value);
    expect(publishLoaded).toHaveBeenLastCalledWith(settings.value);
  });

  it("coordinates auto-save side effects and warns when legacy storage fails", () => {
    const localStorage = storage(true);
    const {
      coordinator,
      autoSaveEnabled,
      cancelAutoSave,
      scheduleDirtyAutoSave,
      warning
    } = harness({ storage: localStorage });

    coordinator.updateAutoSave(false);
    expect(autoSaveEnabled.value).toBe(false);
    expect(cancelAutoSave).toHaveBeenCalledOnce();
    coordinator.updateAutoSave(true);
    expect(scheduleDirtyAutoSave).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "自动保存设置已生效，但暂时无法写入本机配置"
    );
  });

  it("resumes automatic edits only after switching to auto approval", async () => {
    const { coordinator, applyApprovalMode, resumeAutomaticAgentEdits } =
      harness();

    coordinator.updatePermissionMode("request-approval");
    await Promise.resolve();
    expect(resumeAutomaticAgentEdits).not.toHaveBeenCalled();
    coordinator.updatePermissionMode("auto-approve");
    await Promise.resolve();

    expect(applyApprovalMode).toHaveBeenLastCalledWith("auto-approve");
    expect(resumeAutomaticAgentEdits).toHaveBeenCalledOnce();
  });

  it("persists cross-stage auto approval without changing proposal approval mode", async () => {
    const { coordinator, settings, api, applyApprovalMode } = harness();

    coordinator.updateAutoApproveCrossStageOperations(true);
    await coordinator.drain();

    expect(settings.value.autoApproveCrossStageOperations).toBe(true);
    expect(settings.value.permissionMode).toBe("auto-approve");
    expect(applyApprovalMode).not.toHaveBeenCalled();
    expect(api?.save).toHaveBeenCalledWith(
      expect.objectContaining({ autoApproveCrossStageOperations: true })
    );
  });

  it("persists context usage visibility independently", async () => {
    const { coordinator, settings, api } = harness();

    coordinator.updateShowContextUsage(false);
    await coordinator.drain();

    expect(settings.value.showContextUsage).toBe(false);
    expect(api?.save).toHaveBeenCalledWith(
      expect.objectContaining({ showContextUsage: false })
    );
  });
});
