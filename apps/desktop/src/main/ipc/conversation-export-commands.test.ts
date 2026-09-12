import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  disposeConversationExports,
  handleConversationExportCommands
} from "./conversation-export-commands";

type Context = Parameters<typeof handleConversationExportCommands>[0];
const contexts: Context[] = [];
function envelope<T extends string, P>(type: T, payload: P) {
  return createEnvelope(type, payload, { id: randomUUID() });
}
function acceptedPayload(result: CommandResult | undefined): unknown {
  if (result?.status !== "accepted")
    throw new Error("Expected accepted command");
  return result.payload;
}
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(disposeConversationExports));
});
function setup(senderWebContentsId = 100) {
  const showSaveDialog = vi.fn(async () => ({
    canceled: false,
    filePath: "/tmp/deepwrite-export-fixture.json"
  }));
  const requestCommand = vi.fn(
    async (
      _target: string,
      command: CommandEnvelope
    ): Promise<CommandResult> => ({
      status: "accepted",
      requestId: command.id,
      payload:
        command.type === "conversationExport.cancel"
          ? { canceled: true }
          : { nextSeq: 0, bytes: 0 }
    })
  );
  const context = {
    senderWebContentsId,
    getMainWindow: () => ({}),
    dialog: { showSaveDialog },
    supervisor: { requestCommand }
  } as unknown as Context;
  contexts.push(context);
  const begin = envelope("conversationExport.begin", {
    nonce: randomUUID(),
    suggestedName: "测试对话.json"
  });
  return { context, showSaveDialog, requestCommand, begin };
}

describe("conversation export authorization", () => {
  it("opens a single dialog for concurrent nonce retries and never returns a path", async () => {
    const test = setup();
    const [first, duplicate] = await Promise.all([
      handleConversationExportCommands(test.context, test.begin),
      handleConversationExportCommands(test.context, test.begin)
    ]);
    expect(first?.status).toBe("accepted");
    expect(first).toEqual(duplicate);
    expect(acceptedPayload(first)).toEqual({
      canceled: false,
      token: expect.any(String)
    });
    expect(test.showSaveDialog).toHaveBeenCalledOnce();
    expect(test.requestCommand).toHaveBeenCalledOnce();
    const prepare = test.requestCommand.mock.calls[0]![1];
    expect(prepare.type).toBe("conversationExport.prepare");
    expect(prepare.payload).toMatchObject({
      filePath: "/tmp/deepwrite-export-fixture.json"
    });
    const conflicting = envelope("conversationExport.begin", {
      ...test.begin.payload,
      suggestedName: "another.json"
    });
    expect(
      (await handleConversationExportCommands(test.context, conflicting))
        ?.status
    ).toBe("rejected");
  });

  it("retries uncertain prepare acknowledgements with the same authorized token and path", async () => {
    const test = setup();
    test.requestCommand.mockRejectedValueOnce(new Error("测试确认丢失"));
    expect(
      (await handleConversationExportCommands(test.context, test.begin))?.status
    ).toBe("rejected");
    const retry = await handleConversationExportCommands(
      test.context,
      test.begin
    );
    expect(retry?.status).toBe("accepted");
    expect(test.showSaveDialog).toHaveBeenCalledOnce();
    expect(test.requestCommand.mock.calls[0]![1].payload).toEqual(
      test.requestCommand.mock.calls[1]![1].payload
    );
    await disposeConversationExports(test.context);
    expect(test.requestCommand.mock.calls.at(-1)![1].type).toBe(
      "conversationExport.cancel"
    );
  });

  it("rejects direct path authorization and use of another renderer's token", async () => {
    const owner = setup(101);
    const other = setup(102);
    const begin = await handleConversationExportCommands(
      owner.context,
      owner.begin
    );
    const token = (acceptedPayload(begin) as { token: string }).token;
    const stolen = envelope("conversationExport.append", {
      token,
      seq: 0,
      text: "fixture"
    });
    expect(
      (await handleConversationExportCommands(other.context, stolen))?.status
    ).toBe("rejected");
    const arbitrary = envelope("conversationExport.prepare", {
      token,
      filePath: "/tmp/unapproved-fixture.json"
    });
    expect(
      (await handleConversationExportCommands(owner.context, arbitrary))?.status
    ).toBe("rejected");
    expect(other.requestCommand).not.toHaveBeenCalled();
    expect(owner.requestCommand).toHaveBeenCalledOnce();
  });

  it("invalidates a pending dialog when its renderer is destroyed without creating an orphan file", async () => {
    const test = setup();
    let choose!: (value: { canceled: boolean; filePath: string }) => void;
    test.showSaveDialog.mockImplementation(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        })
    );
    const pending = handleConversationExportCommands(test.context, test.begin);
    await disposeConversationExports(test.context);
    choose({ canceled: false, filePath: "/tmp/deepwrite-export-fixture.json" });
    expect(acceptedPayload(await pending)).toEqual({ canceled: true });
    expect(test.requestCommand).not.toHaveBeenCalled();
  });

  it("remembers a canceled selection for a repeated nonce", async () => {
    const test = setup();
    test.showSaveDialog.mockResolvedValue({ canceled: true, filePath: "" });
    expect(
      acceptedPayload(
        await handleConversationExportCommands(test.context, test.begin)
      )
    ).toEqual({ canceled: true });
    expect(
      acceptedPayload(
        await handleConversationExportCommands(test.context, test.begin)
      )
    ).toEqual({ canceled: true });
    expect(test.showSaveDialog).toHaveBeenCalledOnce();
    expect(test.requestCommand).not.toHaveBeenCalled();
  });
});
