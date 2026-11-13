import { describe, expect, it, vi } from "vitest";
import { harness } from "./generalSettingsCoordinator.test-support";

describe("version history preference", () => {
  it("updates optimistically without setting unrelated controls to saving", async () => {
    const test = harness();
    let finish!: (
      value: Awaited<ReturnType<NonNullable<typeof test.api>["save"]>>
    ) => void;
    vi.mocked(test.api!.save).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    test.coordinator.generalSwitchEvents.updateVersionHistoryEnabled(true);
    expect(test.settings.value.versionHistoryEnabled).toBe(true);
    expect(test.autoSaveEnabled.value).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    finish({
      persisted: true,
      settings: { ...test.settings.value, versionHistoryEnabled: true }
    });
    await test.coordinator.drain();
    expect(test.settings.value.versionHistoryEnabled).toBe(true);
  });
  it("rolls back to authority on failure", async () => {
    const test = harness();
    vi.mocked(test.api!.save).mockRejectedValueOnce(
      new Error("disk unavailable")
    );
    test.coordinator.generalSwitchEvents.updateVersionHistoryEnabled(true);
    expect(test.settings.value.versionHistoryEnabled).toBe(true);
    await test.coordinator.drain();
    expect(test.api!.list).toHaveBeenCalledOnce();
    expect(test.settings.value.versionHistoryEnabled).toBe(false);
    expect(test.warning).toHaveBeenCalledOnce();
  });
  it("does not let an older acknowledgment undo a newer choice", async () => {
    const test = harness();
    let finish!: (
      value: Awaited<ReturnType<NonNullable<typeof test.api>["save"]>>
    ) => void;
    vi.mocked(test.api!.save)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockImplementationOnce(async (settings) => ({
        persisted: true,
        settings
      }));
    test.coordinator.generalSwitchEvents.updateVersionHistoryEnabled(true);
    await Promise.resolve();
    await Promise.resolve();
    test.coordinator.generalSwitchEvents.updateVersionHistoryEnabled(false);
    finish({
      persisted: true,
      settings: { ...test.settings.value, versionHistoryEnabled: true }
    });
    await test.coordinator.drain();
    expect(test.settings.value.versionHistoryEnabled).toBe(false);
  });
});
