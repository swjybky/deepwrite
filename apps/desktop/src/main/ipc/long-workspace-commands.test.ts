import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvelope, type CommandResult } from "@deepwrite/contracts";
import { UtilityCommandTimeoutError } from "../supervisor";
import type { IpcCommandContext } from "./command-types";
import { handleLongWorkspaceCommands } from "./long-workspace-commands";

afterEach(() => vi.useRealTimers());

describe("bounded long workspace requests", () => {
  it("routes explicit conflict recovery to Core and retains its rejection", async () => {
    const command = createEnvelope(
      "long.resolveConflicts",
      { bookId: "longbook-conflict" },
      { id: "resolve-command" }
    );
    const rejected = {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "catalog.command_failed",
        message: "长篇工作区索引不是有效 JSON。"
      }
    } as const;
    const requestCommand = vi.fn(async () => rejected);
    const context = { supervisor: { requestCommand } } as unknown as Pick<
      IpcCommandContext,
      "supervisor"
    >;
    await expect(
      handleLongWorkspaceCommands(context, command)
    ).resolves.toEqual(rejected);
    expect(requestCommand).toHaveBeenCalledExactlyOnceWith(
      "core",
      command,
      60_000
    );
  });

  it("rejects malformed successful conflict recovery results", async () => {
    const command = createEnvelope(
      "long.resolveConflicts",
      { bookId: "longbook-conflict" },
      { id: "resolve-malformed" }
    );
    const requestCommand = vi.fn(async () => ({
      status: "accepted",
      requestId: command.id,
      payload: {}
    }));
    const context = { supervisor: { requestCommand } } as unknown as Pick<
      IpcCommandContext,
      "supervisor"
    >;
    await expect(
      handleLongWorkspaceCommands(context, command)
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "long.forward_failed" }
    });
  });

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
