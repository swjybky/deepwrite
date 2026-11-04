import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope";
import { CommandEnvelopeSchema, SystemEventEnvelopeSchema } from "./system";

describe("system notification events", () => {
  it("says whether a refused notification has a settings page to open", () => {
    const blocked = (payload: object) =>
      createEnvelope("system.notification_blocked", payload, {
        id: "evt_notification_blocked"
      });
    expect(
      SystemEventEnvelopeSchema.parse(blocked({ canOpenSettings: true })).type
    ).toBe("system.notification_blocked");
    expect(SystemEventEnvelopeSchema.safeParse(blocked({})).success).toBe(
      false
    );
  });

  it("opens notification settings without letting the caller name a target", () => {
    const open = (payload: object) =>
      createEnvelope("generalSettings.openNotificationSettings", payload, {
        id: "cmd_open_notification_settings"
      });
    expect(CommandEnvelopeSchema.safeParse(open({})).success).toBe(true);
    expect(
      CommandEnvelopeSchema.safeParse(open({ url: "file:///tmp/x" })).success
    ).toBe(false);
  });

  it("accepts a decomposition task settling and rejects an unknown outcome", () => {
    const settled = (outcome: string) =>
      createEnvelope(
        "decomposition.job_settled",
        { jobId: "job-1", outcome },
        { id: "evt_job_settled" }
      );
    for (const outcome of ["completed", "failed", "paused"])
      expect(
        SystemEventEnvelopeSchema.safeParse(settled(outcome)).success
      ).toBe(true);
    expect(
      SystemEventEnvelopeSchema.safeParse(settled("stopped")).success
    ).toBe(false);
  });
});
