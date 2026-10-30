import { afterEach, describe, expect, it } from "vitest";
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
  payload: {}
} as SystemEventEnvelope;

afterEach(() => {
  for (const item of [...uiMessageItems.value]) dismissUiMessage(item.id);
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
