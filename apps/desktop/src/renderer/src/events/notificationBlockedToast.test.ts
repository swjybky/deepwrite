import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemEventEnvelope } from "@deepwrite/contracts";
import { dismissUiMessage, uiMessageItems } from "../ui-feedback";
import { subscribeNotificationBlockedToast } from "./notificationBlockedToast";
import { createSystemEventCenter } from "./systemEventCenter";

const blocked = {
  protocolVersion: 1,
  id: "evt-blocked",
  type: "system.notification_blocked",
  timestamp: "2026-10-30T00:00:00.000Z",
  context: { correlationId: "evt-blocked" },
  payload: { canOpenSettings: true }
} as SystemEventEnvelope;

const openNotificationSettings = vi.fn(async () => undefined);

beforeEach(() => {
  openNotificationSettings.mockClear();
  vi.stubGlobal("window", {
    deepwrite: { generalSettings: { openNotificationSettings } }
  });
});

afterEach(() => {
  for (const item of [...uiMessageItems.value]) dismissUiMessage(item.id);
  vi.unstubAllGlobals();
});

describe("notification blocked toast", () => {
  it("warns that the system did not allow notifications", () => {
    const center = createSystemEventCenter();
    subscribeNotificationBlockedToast(center);
    center.publish(blocked);
    expect(uiMessageItems.value).toHaveLength(1);
    expect(uiMessageItems.value[0]).toMatchObject({
      kind: "warning",
      content: expect.stringContaining("通知")
    });
  });

  it("offers to open the system settings page", () => {
    const center = createSystemEventCenter();
    subscribeNotificationBlockedToast(center);
    center.publish(blocked);
    uiMessageItems.value[0]?.action?.run();
    expect(openNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it("gives advice without a button where the system has no such page", () => {
    const center = createSystemEventCenter();
    subscribeNotificationBlockedToast(center);
    center.publish({
      ...blocked,
      payload: { canOpenSettings: false }
    } as SystemEventEnvelope);
    expect(uiMessageItems.value).toHaveLength(1);
    expect(uiMessageItems.value[0]?.action).toBeUndefined();
  });

  it("replaces the advice instead of stacking a copy", () => {
    const center = createSystemEventCenter();
    subscribeNotificationBlockedToast(center);
    center.publish(blocked);
    center.publish(blocked);
    expect(uiMessageItems.value).toHaveLength(1);
  });

  it("reports when the settings page could not be opened", async () => {
    openNotificationSettings.mockRejectedValueOnce(new Error("no handler"));
    const center = createSystemEventCenter();
    subscribeNotificationBlockedToast(center);
    center.publish(blocked);
    uiMessageItems.value[0]?.action?.run();
    await vi.waitFor(() =>
      expect(uiMessageItems.value.at(-1)).toMatchObject({
        kind: "error",
        content: expect.stringContaining("系统设置")
      })
    );
  });

  it("ignores other events and stops after unsubscribing", () => {
    const center = createSystemEventCenter();
    const stop = subscribeNotificationBlockedToast(center);
    center.publish({
      ...blocked,
      type: "system.worker_restarting",
      payload: {
        worker: "agent",
        reason: "test",
        detectedAt: "2026-10-30T00:00:00.000Z"
      }
    } as SystemEventEnvelope);
    expect(uiMessageItems.value).toHaveLength(0);
    stop();
    center.publish(blocked);
    expect(uiMessageItems.value).toHaveLength(0);
  });
});
