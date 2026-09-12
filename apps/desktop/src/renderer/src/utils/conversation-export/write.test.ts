import { reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ConversationExportApi } from "@deepwrite/contracts/renderer";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { captureCurrentConversation } from "./capture";
import { conversationJsonChunks } from "./json-chunks";
import { exportCurrentConversation } from "./write";

function setupController() {
  const message = reactive({
    id: "fixture-message",
    role: "assistant",
    content: "已显示但尚未保存的正文",
    toolCalls: [
      { arguments: { original: "完整原始参数", nested: { key: "值" } } }
    ],
    editProposal: {
      before: "原文",
      after: "待确认内容",
      undo: { document: "撤回原文" }
    },
    extraVisibleField: "额外可见字段"
  });
  const fixture = {
    sessionId: ref("current-session"),
    messages: ref([message]),
    history: ref([
      {
        sessionId: "current-session",
        createdAt: "2026-09-11T00:00:00.000Z",
        updatedAt: "2026-09-11T01:00:00.000Z"
      }
    ]),
    draft: ref("未发送的草稿"),
    approvalMode: ref("default"),
    temperature: ref(0.7),
    selectedModelId: ref("fixture-model"),
    thinkingLevel: ref("medium"),
    agentTeamMode: ref("single"),
    webSearchEnabled: ref(false),
    capturePersistenceSnapshot: vi.fn(() => {
      throw new Error("Must not read all history");
    }),
    flushPersistence: vi.fn(() => {
      throw new Error("Persistence is unavailable");
    })
  };
  return {
    fixture,
    message,
    controller: fixture as unknown as AgentConversationController
  };
}
function setupApi() {
  const token = "5c5ab87d-1f0f-4ad3-9e84-31c302100493";
  const chunks: string[] = [];
  const api = {
    begin: vi.fn<ConversationExportApi["begin"]>(async () => ({
      canceled: false,
      token
    })),
    append: vi.fn<ConversationExportApi["append"]>(async ({ seq, text }) => {
      chunks[seq] = text;
      return {
        nextSeq: seq + 1,
        bytes: new TextEncoder().encode(chunks.join("")).byteLength
      };
    }),
    finish: vi.fn<ConversationExportApi["finish"]>(async () => ({
      fileName: "fixture.json",
      bytes: 1
    })),
    cancel: vi.fn<ConversationExportApi["cancel"]>(async () => undefined)
  };
  return { api, chunks, token };
}

describe("current conversation recovery capture", () => {
  it("retains unsaved draft, proposals, undo and raw parameters in a stable current-session snapshot", () => {
    const test = setupController();
    const snapshot = captureCurrentConversation(test.controller);
    test.message.content = "capture 后的回复";
    test.message.toolCalls[0]!.arguments.nested.key = "later";
    test.fixture.draft.value = "later draft";
    const decoded = JSON.parse([...conversationJsonChunks(snapshot)].join(""));
    expect(decoded.scope).toBe("current-controller-session");
    expect(decoded.unknownDatabaseFieldsIncluded).toBe(false);
    expect(decoded.includesUnconfirmedChanges).toBe(true);
    expect(decoded.record.messages[0]).toMatchObject({
      content: "已显示但尚未保存的正文",
      toolCalls: [
        { arguments: { original: "完整原始参数", nested: { key: "值" } } }
      ],
      editProposal: {
        before: "原文",
        after: "待确认内容",
        undo: { document: "撤回原文" }
      },
      extraVisibleField: "额外可见字段"
    });
    expect(decoded.record.draft).toBe("未发送的草稿");
    expect(test.fixture.capturePersistenceSnapshot).not.toHaveBeenCalled();
    expect(test.fixture.flushPersistence).not.toHaveBeenCalled();
  });

  it("preserves sparse JSON data and refuses non-JSON classes instead of silently dropping their data", () => {
    const test = setupController();
    Object.assign(test.message, { sparse: new Array(3) });
    const snapshot = captureCurrentConversation(test.controller);
    const decoded = JSON.parse([...conversationJsonChunks(snapshot)].join(""));
    expect(decoded.record.messages[0].sparse).toEqual([null, null, null]);
    Object.assign(test.message, { unknownMap: new Map([["key", "value"]]) });
    expect(() => captureCurrentConversation(test.controller)).toThrow(
      "非 JSON 对象"
    );
  });
});

describe("current conversation recovery writer", () => {
  it("captures before the dialog, retries lost acknowledgements with identical nonce/seq and never flushes the database", async () => {
    const test = setupController();
    const sink = setupApi();
    sink.api.begin.mockRejectedValueOnce(new Error("测试 begin ACK 丢失"));
    sink.api.begin.mockImplementationOnce(async () => {
      test.message.content = "after capture";
      test.fixture.draft.value = "after capture draft";
      return { canceled: false, token: sink.token };
    });
    sink.api.append.mockImplementationOnce(async ({ seq, text }) => {
      sink.chunks[seq] = text;
      throw new Error("测试 append ACK 丢失");
    });
    sink.api.finish.mockRejectedValueOnce(new Error("测试 finish ACK 丢失"));
    expect(
      await exportCurrentConversation(
        test.controller,
        sink.api,
        new AbortController().signal
      )
    ).toMatchObject({ fileName: "fixture.json" });
    expect(sink.api.begin.mock.calls[0]).toEqual(sink.api.begin.mock.calls[1]);
    expect(sink.api.append.mock.calls[0]).toEqual(
      sink.api.append.mock.calls[1]
    );
    expect(sink.api.finish.mock.calls[0]).toEqual(
      sink.api.finish.mock.calls[1]
    );
    const decoded = JSON.parse(sink.chunks.join(""));
    expect(decoded.record.messages[0].content).toBe("已显示但尚未保存的正文");
    expect(decoded.record.draft).toBe("未发送的草稿");
    expect(test.fixture.flushPersistence).not.toHaveBeenCalled();
    expect(sink.api.cancel).not.toHaveBeenCalled();
  });

  it("cleans temporary state on cancellation after the dialog and on write failure", async () => {
    const test = setupController();
    const sink = setupApi();
    const abort = new AbortController();
    sink.api.begin.mockImplementationOnce(async () => {
      abort.abort();
      return { canceled: false, token: sink.token };
    });
    await expect(
      exportCurrentConversation(test.controller, sink.api, abort.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sink.api.append).not.toHaveBeenCalled();
    expect(sink.api.cancel).toHaveBeenCalledWith({ token: sink.token });
    sink.api.append.mockRejectedValue(new Error("测试磁盘已满"));
    await expect(
      exportCurrentConversation(
        test.controller,
        sink.api,
        new AbortController().signal
      )
    ).rejects.toThrow("测试磁盘已满");
    expect(sink.api.cancel).toHaveBeenCalledTimes(2);
    expect(sink.api.finish).not.toHaveBeenCalled();
  });

  it("leaves no file transaction when the user cancels the native dialog", async () => {
    const test = setupController();
    const sink = setupApi();
    sink.api.begin.mockResolvedValue({ canceled: true });
    expect(
      await exportCurrentConversation(
        test.controller,
        sink.api,
        new AbortController().signal
      )
    ).toBeUndefined();
    expect(sink.api.append).not.toHaveBeenCalled();
    expect(sink.api.cancel).not.toHaveBeenCalled();
  });
});
