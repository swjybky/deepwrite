import { ExternalControlStateFileSchema } from "@deepwrite/contracts/external-control";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileMock, createServerMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  createServerMock: vi.fn()
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: readFileMock };
});

vi.mock("./control-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./control-server")>();
  return { ...actual, createExternalControlServer: createServerMock };
});

import { readPrivateJson } from "./control-state-file";
import { createExternalControl } from "./index";
import {
  TEST_TOKEN,
  createTestPaths,
  testAppState,
  testControlOptions
} from "./external-control.test-support";

describe("external control resilience", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    createServerMock.mockReset();
  });

  it("retries transient EBUSY/EPERM errors when reading state json", async () => {
    const busy = Object.assign(new Error("busy"), { code: "EBUSY" });
    const perm = Object.assign(new Error("perm"), { code: "EPERM" });
    const sample = {
      status: "disabled" as const,
      protocolVersion: 1,
      appVersion: "1.0.0",
      pid: 4242
    };
    readFileMock
      .mockRejectedValueOnce(busy)
      .mockRejectedValueOnce(perm)
      .mockResolvedValueOnce(JSON.stringify(sample));

    await expect(
      readPrivateJson(
        join(tmpdir(), "example-state.json"),
        ExternalControlStateFileSchema
      )
    ).resolves.toEqual(sample);
    expect(readFileMock).toHaveBeenCalledTimes(3);
  });

  it("self-heals after an unexpected control server close and cancels recovery on stop", async () => {
    readFileMock.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" })
    );
    const { paths, cleanup } = await createTestPaths();
    const handlers: Array<{ onUnexpectedClose?: () => void }> = [];
    const startMock = vi.fn(async () => undefined);
    const stopMock = vi.fn(async () => undefined);
    createServerMock.mockImplementation(
      (opts: { onUnexpectedClose?: () => void }) => {
        handlers.push(opts);
        return {
          start: startMock,
          stop: stopMock,
          disconnectClient: vi.fn()
        };
      }
    );

    const control = createExternalControl({
      ...testControlOptions(paths),
      app: testAppState({ dataDirectory: () => paths.directory }),
      pid: 4242,
      createToken: () => TEST_TOKEN,
      warn: vi.fn()
    });

    try {
      await control.sync(true);
      expect(startMock).toHaveBeenCalledTimes(1);

      handlers[0]?.onUnexpectedClose?.();
      await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(2), {
        timeout: 2_000
      });

      handlers[1]?.onUnexpectedClose?.();
      await control.stop();
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(startMock).toHaveBeenCalledTimes(2);
    } finally {
      await control.stop();
      await cleanup();
    }
  });
});
