import { describe, expect, it, vi } from "vitest";
import { CommandEnvelopeSchema } from "@deepwrite/contracts";
import { mergeSiteOfficialQuota } from "../../preload/site-official-models-api";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: { invoke } }));
const input = {
  sourceKey: "source_test_only_invalid",
  targetRevision: "10000000-0000-4000-8000-000000000001"
};
const result = {
  transferred: "3.123456",
  sourceRevoked: true,
  quota: {
    queriedAt: "2026-09-09T00:00:00Z",
    remaining: 3.123456,
    used: 10,
    total: 13.123456,
    unlimited: false,
    targetRevision: input.targetRevision
  }
};

describe("quota merge preload boundary", () => {
  it("validates both directions and strips unknown payload fields", async () => {
    invoke.mockImplementationOnce(async (_channel, raw) => {
      const command = CommandEnvelopeSchema.parse(raw);
      expect(command.type).toBe("models.mergeSiteOfficialQuota");
      expect(command.payload).toEqual(input);
      return {
        status: "accepted",
        requestId: command.id,
        payload: { ...result, source_key: input.sourceKey }
      };
    });
    expect(await mergeSiteOfficialQuota(input)).toEqual(result);
  });

  it("does not send invalid source or target confirmation", async () => {
    invoke.mockClear();
    await expect(
      mergeSiteOfficialQuota({ ...input, sourceKey: " " })
    ).rejects.toThrow();
    await expect(
      mergeSiteOfficialQuota({ ...input, targetRevision: "invalid" })
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed accepted responses instead of reporting success", async () => {
    invoke.mockImplementationOnce(async (_channel, command) => ({
      status: "accepted",
      requestId: command.id,
      payload: { ...result, sourceRevoked: false }
    }));
    await expect(mergeSiteOfficialQuota(input)).rejects.toThrow();
  });
});
