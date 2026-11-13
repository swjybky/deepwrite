import { describe, expect, it } from "vitest";
import {
  characterWriteEvent,
  harness
} from "./useLongWorkspaceProposals.test-support";

describe("long proposal version origin", () => {
  it.each(["auto-approve", "request-approval"] as const)(
    "captures %s origins when enqueued and keeps them through review",
    async (mode) => {
      const origin = {
        sessionId: "session_long",
        runId: "run_long",
        summary: "改写人物设定"
      };
      let currentOrigin = origin;
      const test = harness(true, mode, () => currentOrigin);
      const event = characterWriteEvent();
      await test.controller.handleEvent(event);
      currentOrigin = { ...origin, runId: "later-run", summary: "下一轮" };
      if (mode === "request-approval")
        await test.controller.approve("longbook_test", event.id);
      expect(test.applyOperations).toHaveBeenCalledWith(
        expect.objectContaining({ versionOrigin: origin })
      );
    }
  );
});
