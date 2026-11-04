import { describe, expect, it, vi } from "vitest";
import { queueExternalOperation } from "./operation-queue";

describe("external setup queue", () => {
  it("preserves setup order and advances after a rejection", async () => {
    const owner = {};
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queueExternalOperation(owner, async () => {
      seen.push("first");
      await gate;
      throw new Error("setup failed");
    });
    const caught = first.catch(() => undefined);
    const second = queueExternalOperation(owner, async () => {
      seen.push("second");
      return "run-id";
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["first"]);
    release();
    await caught;
    await expect(second).resolves.toBe("run-id");
    expect(seen).toEqual(["first", "second"]);
  });

  it("does not perform a timed-out mutation later", async () => {
    vi.useFakeTimers();
    try {
      const owner = {};
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = queueExternalOperation(owner, () => gate);
      const mutation = vi.fn(async () => undefined);
      const pending = queueExternalOperation(owner, mutation);
      const rejected = expect(pending).rejects.toMatchObject({
        code: "external.busy"
      });
      await vi.advanceTimersByTimeAsync(8_001);
      await rejected;
      release();
      await first;
      await queueExternalOperation(owner, async () => undefined);
      expect(mutation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
