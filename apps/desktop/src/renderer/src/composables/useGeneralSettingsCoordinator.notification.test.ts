import { describe, expect, it, vi } from "vitest";
import {
  createDefaultGeneralSettings,
  type GeneralSettingsSnapshot
} from "@deepwrite/contracts";
import { deferred, harness } from "./generalSettingsCoordinator.test-support";

function notificationHarness(enabled = false) {
  const saved = {
    ...createDefaultGeneralSettings(),
    taskNotification: enabled
  };
  const api = {
    list: vi.fn(async () => ({ persisted: true, settings: { ...saved } })),
    save: vi.fn(async (settings: typeof saved) => {
      Object.assign(saved, settings);
      return { persisted: true, settings: { ...saved } };
    })
  };
  return { ...harness({ api }), api };
}

describe("notification preference persistence", () => {
  it.each([false, true])(
    "restores Main's %s setting after a failed toggle",
    async (enabled) => {
      const test = notificationHarness(enabled);
      await test.coordinator.load();
      test.api.save.mockRejectedValueOnce(new Error("disk unavailable"));
      test.coordinator.updateTaskNotification(!enabled);
      expect(test.settings.value.taskNotification).toBe(!enabled);
      await test.coordinator.drain();
      expect(test.settings.value.taskNotification).toBe(enabled);
      expect(test.api.list).toHaveBeenCalledTimes(2);
      expect(test.warning).toHaveBeenCalledWith(
        "通知设置保存失败，请重试：disk unavailable"
      );
      test.coordinator.updateTaskNotification(!enabled);
      await test.coordinator.drain();
      expect(test.settings.value.taskNotification).toBe(!enabled);
    }
  );

  it("falls back to the last acknowledged setting when recovery reading fails", async () => {
    const test = notificationHarness(true);
    await test.coordinator.load();
    test.api.save.mockRejectedValueOnce(new Error("disk unavailable"));
    test.api.list.mockRejectedValueOnce(new Error("read unavailable"));
    test.coordinator.updateTaskNotification(false);
    await test.coordinator.drain();
    expect(test.settings.value.taskNotification).toBe(true);
  });

  it("uses Main's fresh value when a rejected command has already applied its setting", async () => {
    const test = notificationHarness();
    await test.coordinator.load();
    test.api.save.mockRejectedValueOnce(new Error("response failed"));
    test.api.list.mockResolvedValueOnce({
      persisted: true,
      settings: { ...createDefaultGeneralSettings(), taskNotification: true }
    });
    test.coordinator.updateTaskNotification(true);
    await test.coordinator.drain();
    expect(test.settings.value.taskNotification).toBe(true);
  });

  it("keeps a later choice when recovery reading is still pending", async () => {
    const test = notificationHarness();
    await test.coordinator.load();
    const recovery = deferred<GeneralSettingsSnapshot>();
    const reading = deferred<void>();
    const nextSave = deferred<GeneralSettingsSnapshot>();
    const saving = deferred<void>();
    test.api.save.mockRejectedValueOnce(new Error("disk unavailable"));
    test.api.save.mockImplementationOnce(() => {
      saving.resolve();
      return nextSave.promise;
    });
    test.api.list.mockImplementationOnce(() => {
      reading.resolve();
      return recovery.promise;
    });
    test.coordinator.updateTaskNotification(true);
    await reading.promise;
    test.coordinator.updateTaskNotification(false);
    test.coordinator.updateTaskNotification(true);
    recovery.resolve({
      persisted: true,
      settings: createDefaultGeneralSettings()
    });
    await saving.promise;
    expect(test.settings.value.taskNotification).toBe(true);
    nextSave.resolve({
      persisted: true,
      settings: createDefaultGeneralSettings()
    });
    await test.coordinator.drain();
    expect(test.settings.value.taskNotification).toBe(true);
    expect(test.api.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskNotification: true })
    );
  });

  it("ignores older failures when a newer snapshot is already queued", async () => {
    const test = notificationHarness();
    await test.coordinator.load();
    const first = deferred<void>();
    test.api.save.mockImplementationOnce(async () => {
      await first.promise;
      throw new Error("disk unavailable");
    });
    test.coordinator.updateTaskNotification(true);
    test.coordinator.updateShowContextUsage(false);
    first.resolve();
    await test.coordinator.drain();
    expect(test.settings.value.taskNotification).toBe(true);
    expect(test.settings.value.showContextUsage).toBe(false);
    expect(test.api.list).toHaveBeenCalledTimes(1);
  });
});
