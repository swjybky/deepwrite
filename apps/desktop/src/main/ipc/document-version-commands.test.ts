import { describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createDefaultGeneralSettings,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { UtilityCommandTimeoutError } from "../supervisor";
import {
  filterVersionOrigin,
  handleDocumentVersionCommands
} from "./document-version-commands";
import { dispatchCommand } from "./dispatch-command";
import type { IpcCommandContext } from "./command-types";

const target = {
  workspace: "catalog",
  bookId: "book-a",
  documentId: "draft"
} as const;
const current = { sha256: "a".repeat(64), charCount: 4 };
const origin = { sessionId: "session-a", runId: "run-a", summary: "修改正文" };
function command(
  type: "versions.list" | "versions.read" | "versions.restore"
): CommandEnvelope {
  return CommandEnvelopeSchema.parse(
    createEnvelope(
      type,
      {
        target,
        ...(type !== "versions.list" ? { versionId: "v1-1234abcd" } : {}),
        ...(type === "versions.restore"
          ? { expectedCurrentSha256: current.sha256 }
          : {})
      },
      { id: "version-command", timestamp: "2026-11-11T00:00:00.000Z" }
    )
  );
}
function context(enabled = true, resources: string[] = []) {
  return {
    versionHistoryEnabled: enabled,
    activeRuns: new Map(
      resources.map((resourceId, index) => [String(index), { resourceId }])
    ),
    supervisor: {
      requestCommand: vi.fn(
        async (
          _worker: string,
          request: CommandEnvelope
        ): Promise<CommandResult> => ({
          status: "accepted",
          requestId: request.id,
          payload: { versions: [], current }
        })
      )
    }
  };
}

describe("Main document version gate", () => {
  it.each(["catalog.saveDocument", "long.applyOperations"] as const)(
    "forwards %s with Main's current version setting",
    async (type) => {
      const original = createEnvelope(
        type,
        type === "catalog.saveDocument"
          ? {
              bookId: "book-a",
              documentId: "draft",
              content: "text",
              versionOrigin: origin
            }
          : {
              bookId: "book-a",
              batch: {
                updatedAt: "2026-11-11T00:00:00.000Z",
                operations: [],
                documentWrites: []
              },
              versionOrigin: origin
            },
        { id: "gated-write" }
      ) as CommandEnvelope;
      for (const enabled of [false, true]) {
        const requestCommand = vi.fn(
          async (
            _worker: string,
            _command: CommandEnvelope
          ): Promise<CommandResult> => ({
            status: "rejected",
            requestId: original.id,
            error: { code: "catalog.conflict", message: "fixture" }
          })
        );
        const ctx = {
          supervisor: { requestCommand },
          activeRuns: new Map(),
          requireGeneralSettingsStore: () => ({
            list: async () => ({
              settings: {
                ...createDefaultGeneralSettings(),
                versionHistoryEnabled: enabled
              }
            })
          })
        } as unknown as IpcCommandContext;
        await dispatchCommand(ctx, original);
        expect(requestCommand).toHaveBeenCalledOnce();
        const forwarded = requestCommand.mock.calls[0]![1] as CommandEnvelope;
        if (enabled)
          expect(forwarded.payload).toHaveProperty("versionOrigin", origin);
        else expect(forwarded.payload).not.toHaveProperty("versionOrigin");
      }
    }
  );

  it.each([
    "catalog.saveDocument",
    "catalog.createDraftSections",
    "long.applyOperations"
  ] as const)("strips versionOrigin from %s only while disabled", (type) => {
    const original = createEnvelope(
      type,
      type === "catalog.saveDocument"
        ? {
            bookId: "book-a",
            documentId: "draft",
            content: "text",
            versionOrigin: origin
          }
        : type === "catalog.createDraftSections"
          ? {
              bookId: "book-a",
              operationId: "batch",
              sections: [{ clientSectionId: "a", bodyContent: "draft" }],
              versionOrigin: origin
            }
          : {
              bookId: "book-a",
              batch: {
                updatedAt: "2026-11-11T00:00:00.000Z",
                operations: [],
                documentWrites: []
              },
              versionOrigin: origin
            },
      { id: "write-command" }
    ) as CommandEnvelope;
    expect(filterVersionOrigin(original, true)).toBe(original);
    const filtered = filterVersionOrigin(original, false);
    expect(filtered.payload).not.toHaveProperty("versionOrigin");
    expect(original.payload).toHaveProperty("versionOrigin", origin);
    expect(filtered).toMatchObject({
      id: original.id,
      type,
      context: original.context
    });
  });

  it.each(["versions.list", "versions.read", "versions.restore"] as const)(
    "rejects %s while disabled before forwarding",
    async (type) => {
      const ctx = context(false);
      await expect(
        handleDocumentVersionCommands(ctx, command(type))
      ).resolves.toMatchObject({
        status: "rejected",
        error: { code: "version.disabled" }
      });
      expect(ctx.supervisor.requestCommand).not.toHaveBeenCalled();
    }
  );

  it("permits viewing during runs and refuses only restores of the occupied work", async () => {
    const ctx = context(true, ["book-a"]);
    await expect(
      handleDocumentVersionCommands(ctx, command("versions.list"))
    ).resolves.toMatchObject({ status: "accepted", payload: { versions: [] } });
    ctx.supervisor.requestCommand.mockClear();
    await expect(
      handleDocumentVersionCommands(ctx, command("versions.restore"))
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "version.busy" }
    });
    expect(ctx.supervisor.requestCommand).not.toHaveBeenCalled();
  });

  it("forwards restores of other works and retains structured Core failures", async () => {
    const ctx = context(true, ["book-b"]);
    const rejected = {
      status: "rejected",
      requestId: "version-command",
      error: { code: "version.conflict", message: "changed" }
    } as const;
    ctx.supervisor.requestCommand.mockResolvedValueOnce(rejected);
    await expect(
      handleDocumentVersionCommands(ctx, command("versions.restore"))
    ).resolves.toEqual(rejected);
    expect(ctx.supervisor.requestCommand).toHaveBeenCalledWith(
      "core",
      command("versions.restore"),
      60_000
    );
  });

  it("rejects malformed Core replies and reports unresolved restore timeouts", async () => {
    const ctx = context();
    ctx.supervisor.requestCommand.mockResolvedValueOnce({
      status: "accepted",
      requestId: "version-command",
      payload: {}
    });
    await expect(
      handleDocumentVersionCommands(ctx, command("versions.list"))
    ).resolves.toMatchObject({
      status: "rejected",
      error: { code: "version.forward_failed" }
    });
    ctx.supervisor.requestCommand.mockRejectedValueOnce(
      new UtilityCommandTimeoutError("timeout")
    );
    await expect(
      handleDocumentVersionCommands(ctx, command("versions.restore"))
    ).resolves.toMatchObject({
      status: "rejected",
      error: {
        code: "version.command_timeout",
        message: expect.stringContaining("保存结果尚未确认")
      }
    });
  });
});
