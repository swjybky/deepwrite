import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, type CommandResult } from "@deepwrite/contracts";
import { UtilityCommandTimeoutError } from "../supervisor";
import type { IpcCommandContext } from "./command-types";
import { handleLongWorkspaceCommands } from "./long-workspace-commands";

afterEach(() => vi.useRealTimers());

describe("bounded long workspace requests", () => {
  it("returns an unresolved-result error for a stalled save without replaying it", async () => {
    vi.useFakeTimers();
    const requestCommand = vi.fn(
      (_worker, _command, timeoutMs) =>
        new Promise<CommandResult>((_resolve, reject) => {
          if (timeoutMs > 0)
            setTimeout(
              () => reject(new UtilityCommandTimeoutError("模拟无响应")),
              timeoutMs
            );
        })
    );
    const context = { supervisor: { requestCommand } } as unknown as Pick<
      IpcCommandContext,
      "supervisor"
    >;
    const result = handleLongWorkspaceCommands(
      context,
      createEnvelope(
        "long.applyOperations",
        {
          bookId: "longbook-timeout",
          batch: {
            updatedAt: "2026-09-10T00:00:00.000Z",
            operations: [],
            documentWrites: []
          }
        },
        { id: "apply-timeout" }
      )
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toMatchObject({
      status: "rejected",
      requestId: "apply-timeout",
      error: {
        code: "long.command_timeout",
        message: expect.stringContaining("结果尚未确认")
      }
    });
    expect(requestCommand).toHaveBeenCalledOnce();
  });
});
