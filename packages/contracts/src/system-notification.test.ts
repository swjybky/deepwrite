import { describe, expect, it } from "vitest";
import { createEnvelope } from "./envelope";
import { SystemEventEnvelopeSchema } from "./system";

describe("system notification events", () => {
  it("accepts the refused-notification event with an empty payload", () => {
    const event = createEnvelope(
      "system.notification_blocked",
      {},
      { id: "evt_notification_blocked" }
    );
    expect(SystemEventEnvelopeSchema.parse(event).type).toBe(
      "system.notification_blocked"
    );
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
