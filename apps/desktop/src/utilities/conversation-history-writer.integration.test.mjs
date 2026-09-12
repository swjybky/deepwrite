import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toRaw } from "vue";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryStageSchema
} from "@deepwrite/contracts";
import { ConversationDatabase } from "./conversation-storage/database";
import { JsonNodes } from "./conversation-storage/json-nodes";
import { createConversationHistoryWrite } from "../renderer/src/utils/conversationHistoryWriter";
import { useAgentConversation } from "../renderer/src/composables/useAgentConversation";
import {
  createDeferredApi,
  document,
  runtime
} from "../renderer/src/composables/useAgentConversation.test-support";
const key = "conversation-history:integration-fixture";
const date = "2026-09-11T00:00:00.000Z";
const cleanup = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
function message(id, content, role = "assistant") {
  return { id, role, content, createdAt: date, status: "completed" };
}
async function storage() {
  const directory = await mkdtemp(
    join(tmpdir(), "deepwrite-history-integration-")
  );
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const database = new ConversationDatabase(join(directory, "history.sqlite"));
  cleanup.push(() => database.close());
  const api = {
    commit: async (batch) =>
      database.commit(ConversationHistoryBatchSchema.parse(batch)),
    stage: async (batch) =>
      database.stage(ConversationHistoryStageSchema.parse(batch)),
    session: async (query) => database.session(query),
    list: async (query) => database.list(query),
    messages: async (query) => database.messages(query),
    detail: async (query) => database.detail(query),
    metadataDetail: async (query) => database.metadataDetail(query),
    turns: async (query) => database.turns(query)
  };
  return { database, api };
}
function flushing(api, controller) {
  let pending;
  return async () => {
    for (;;) {
      if (!pending) {
        const changes = controller().capturePersistenceChanges();
        if (!changes.conversations.length) return;
        pending = {
          revision: changes.revision,
          write: createConversationHistoryWrite(api, key, changes)
        };
      }
      await pending.write();
      controller().acknowledgePersistenceChanges(pending.revision);
      pending = undefined;
    }
  };
}
function full(database, sessionId, messageId) {
  const revision = database.session({ key, sessionId }).revision;
  let offset = 0;
  let content = "";
  for (;;) {
    const result = database.detail({
      key,
      sessionId,
      messageId,
      path: [],
      expectedRevision: revision,
      offset,
      maxBytes: 64 * 1024
    });
    content += result.chunk;
    if (result.nextOffset === null) return JSON.parse(content);
    offset = result.nextOffset;
  }
}
describe("controller → incremental writer → SQLite", () => {
  it("stages a draft larger than one IPC budget and retains its receipt through retry", async () => {
    const { database, api } = await storage();
    const controller = useAgentConversation({ api: () => undefined });
    cleanup.push(() => controller.dispose());
    const draft = "保留草稿😀".repeat(700_000);
    controller.messages.value = [
      {
        id: "sent-first",
        role: "user",
        content: "已发送的消息",
        createdAt: "2026-09-07T00:00:00.000Z"
      }
    ];
    controller.draft.value = draft;
    const changes = controller.capturePersistenceChanges();
    const commit = api.commit;
    let loseReceipt = true;
    api.commit = async (batch) => {
      const receipt = await commit(batch);
      if (loseReceipt) {
        loseReceipt = false;
        throw new Error("模拟草稿确认丢失");
      }
      return receipt;
    };
    const write = createConversationHistoryWrite(api, key, changes);
    await expect(write()).rejects.toThrow("模拟草稿确认丢失");
    await write();
    controller.acknowledgePersistenceChanges(changes.revision);
    const sessionId = controller.sessionId.value;
    const session = database.session({ key, sessionId, maxBytes: 4096 });
    expect(session.metadata.draft).toBeUndefined();
    expect(session.metadataDetails.some((ref) => ref.path[0] === "draft")).toBe(
      true
    );
    let offset = 0;
    let restored = "";
    do {
      const part = database.metadataDetail({
        key,
        sessionId,
        path: ["draft"],
        expectedRevision: session.revision,
        offset,
        maxBytes: 64 * 1024
      });
      expect(Buffer.byteLength(part.chunk)).toBeLessThanOrEqual(64 * 1024);
      restored += part.chunk;
      offset = part.nextOffset;
    } while (offset !== null);
    expect(restored).toBe(draft);
    expect(controller.capturePersistenceChanges().conversations).toHaveLength(
      0
    );
  });
  it("saves a user message before dispatch and resumes an uncertain save without duplicating it", async () => {
    const { database, api } = await storage();
    const model = createDeferredApi();
    const commit = api.commit;
    let loseReceipt = true;
    api.commit = async (batch) => {
      const receipt = await commit(batch);
      if (loseReceipt) {
        loseReceipt = false;
        throw new Error("模拟提交成功但确认丢失");
      }
      return receipt;
    };
    let controller;
    const flush = flushing(api, () => controller);
    controller = useAgentConversation({
      api: () => model.api,
      flushPersistence: flush
    });
    cleanup.push(() => controller.dispose());
    controller.draft.value = "必须先保存的提问";
    await controller.sendMessage(document);
    expect(model.prompts).toHaveLength(0);
    const id = controller.messages.value[0].id;
    expect(full(database, controller.sessionId.value, id).content).toBe(
      "必须先保存的提问"
    );
    expect(controller.draft.value).toBe("必须先保存的提问");
    controller.draft.value = "修订后仍须先保存的提问";
    const retry = controller.sendMessage(document);
    await vi.waitFor(() => expect(model.prompts).toHaveLength(1));
    expect(full(database, controller.sessionId.value, id).content).toBe(
      "修订后仍须先保存的提问"
    );
    model.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run-durable-retry",
      runtime,
      acceptedAt: date
    });
    await retry;
    await flush();
    expect(
      database.session({ key, sessionId: controller.sessionId.value })
        ?.messageCount
    ).toBe(1);
    expect(controller.messages.value[0]?.id).toBe(id);
    expect(full(database, controller.sessionId.value, id).content).toBe(
      "修订后仍须先保存的提问"
    );
  });
  it("retries the same partially committed multi-batch append and retains changes after its checkpoint", async () => {
    const { database, api } = await storage();
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("active", "原文")]
    });
    cleanup.push(() => controller.dispose());
    const flush = flushing(api, () => controller);
    await flush();
    const commit = api.commit;
    let calls = 0;
    api.commit = async (batch) => {
      const receipt = await commit(batch);
      calls += 1;
      if (calls === 2) throw new Error("模拟第二批提交后连接中断");
      return receipt;
    };
    const appended = "虚构增量😀".repeat(140_000);
    controller.messages.value[0].content += appended;
    await expect(flush()).rejects.toThrow("第二批");
    const partial = full(
      database,
      controller.sessionId.value,
      "active"
    ).content;
    expect(partial.length).toBeGreaterThan(2);
    expect(partial.length).toBeLessThan(appended.length + 2);
    controller.messages.value[0].content += "确认之后的新尾部";
    await flush();
    await flush();
    expect(full(database, controller.sessionId.value, "active").content).toBe(
      `原文${appended}确认之后的新尾部`
    );
    expect(
      database.session({ key, sessionId: controller.sessionId.value })
        ?.messageCount
    ).toBe(1);
  }, 20_000);
  it("rewrites a middle prompt while keeping its prefix and exact database order", async () => {
    const { database, api } = await storage();
    const model = createDeferredApi();
    let controller;
    const flush = flushing(api, () => controller);
    controller = useAgentConversation({
      api: () => model.api,
      initialMessages: [
        message("u0", "前文问题", "user"),
        message("a0", "前文回答"),
        message("u1", "待改问题", "user"),
        message("a1", "应移除回答")
      ],
      flushPersistence: flush
    });
    cleanup.push(() => controller.dispose());
    await flush();
    const sending = controller.resendMessage(
      { messageId: "u1", content: "修改后的问题" },
      document
    );
    await vi.waitFor(() => expect(model.prompts).toHaveLength(1));
    expect(
      model.prompts[0]?.conversationHistory?.map((item) => item.content)
    ).toEqual(["前文问题", "前文回答"]);
    model.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "rewrite",
      runtime,
      acceptedAt: date
    });
    await sending;
    const rows = database.messages({
      key,
      sessionId: controller.sessionId.value
    });
    expect(rows.messages.map((row) => row.messageId)).toEqual(
      controller.messages.value.map((item) => item.id)
    );
    expect(rows.messages.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(
      full(
        database,
        controller.sessionId.value,
        controller.messages.value[2].id
      ).content
    ).toBe("修改后的问题");
  });
  it("moves restored messages without overwriting unknown fields and does not re-put cloned history when switching", async () => {
    const { database, api } = await storage();
    const futureMessage = {
      ...message("a", "第一条"),
      futurePayload: { raw: "未知字段完整保留" }
    };
    const source = useAgentConversation({
      api: () => undefined,
      initialMessages: [futureMessage, message("b", "第二条")]
    });
    cleanup.push(() => source.dispose());
    await flushing(api, () => source)();
    const sessionId = source.sessionId.value;
    const metadata = source.capturePersistenceSnapshot().conversations[0];
    const controller = useAgentConversation({
      api: () => undefined,
      initialPersistenceSnapshot: {
        version: 1,
        activeSessionId: sessionId,
        conversations: [
          {
            ...metadata,
            messages: [
              full(database, sessionId, "a"),
              full(database, sessionId, "b")
            ]
          }
        ]
      }
    });
    cleanup.push(() => controller.dispose());
    expect(controller.initializePersistenceBaseline()).toBe(true);
    controller.messages.value.reverse();
    const reordered = controller.capturePersistenceChanges();
    expect(
      reordered.conversations[0]?.operations.map((operation) => operation.type)
    ).toEqual(["moveMessage", "moveMessage"]);
    const flush = flushing(api, () => controller);
    await flush();
    expect(
      database.messages({ key, sessionId }).messages.map((row) => row.messageId)
    ).toEqual(["b", "a"]);
    expect(full(database, sessionId, "a").futurePayload).toEqual({
      raw: "未知字段完整保留"
    });
    controller.newConversation();
    controller.messages.value.push(message("other", "另一会话"));
    await flush();
    controller.selectConversation(sessionId);
    const changed = controller.capturePersistenceChanges();
    expect(
      changed.conversations.flatMap((conversation) => conversation.operations)
    ).toEqual([]);
    await flush();
    expect(full(database, sessionId, "a").futurePayload).toEqual({
      raw: "未知字段完整保留"
    });
  });
  it("appends to the current message without reading dozens of MiB of old payloads", async () => {
    const { database, api } = await storage();
    const payload = "仅用于容量回归的虚构正文".repeat(30_000);
    const initialMessages = Array.from({ length: 50 }, (_, index) => ({
      ...message(`old-${index}`, "历史答复"),
      toolCalls: [
        {
          id: `call-${index}`,
          name: "read_text",
          args: { text: payload },
          status: "completed",
          requestedAt: date
        }
      ]
    }));
    initialMessages.push(message("active", "新的回复"));
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages
    });
    cleanup.push(() => controller.dispose());
    const flush = flushing(api, () => controller);
    await flush();
    expect(
      database.session({ key, sessionId: controller.sessionId.value })
        .byteLength
    ).toBeGreaterThan(40 * 1024 * 1024);
    const oldReads = vi.fn();
    for (const old of controller.messages.value.slice(0, -1)) {
      const raw = toRaw(old);
      const value = raw.toolCalls;
      Object.defineProperty(raw, "toolCalls", {
        enumerable: true,
        configurable: true,
        get() {
          oldReads();
          return value;
        }
      });
    }
    const readNodes = vi.spyOn(JsonNodes.prototype, "read");
    const commit = vi.spyOn(api, "commit");
    controller.messages.value.at(-1).content += "增量";
    await flush();
    expect(oldReads).not.toHaveBeenCalled();
    expect(readNodes.mock.calls.length).toBeLessThan(20);
    expect(JSON.stringify(commit.mock.calls).length).toBeLessThan(2000);
    readNodes.mockRestore();
    expect(full(database, controller.sessionId.value, "active").content).toBe(
      "新的回复增量"
    );
  }, 30_000);
  it("captures the latest replacement value after switching through cloned history before acknowledgement", async () => {
    const { database, api } = await storage();
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [message("original", "原文")]
    });
    cleanup.push(() => controller.dispose());
    const flush = flushing(api, () => controller);
    await flush();
    const sessionId = controller.sessionId.value;
    controller.messages.value[0].content = "替换内容";
    controller.newConversation();
    controller.messages.value.push(message("other", "其他会话"));
    controller.selectConversation(sessionId);
    controller.messages.value[0].content += "切换之后的追加";
    await flush();
    expect(full(database, sessionId, "original").content).toBe(
      "替换内容切换之后的追加"
    );
  });
  it("tracks shared argument subtrees after a same-ID history clone and after an ancestor array replacement", async () => {
    const { database, api } = await storage();
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [
        {
          ...message("original", "正文"),
          toolCalls: [
            {
              id: "tool",
              name: "read_text",
              args: { text: "参数" },
              status: "completed",
              requestedAt: date
            }
          ]
        }
      ]
    });
    cleanup.push(() => controller.dispose());
    const flush = flushing(api, () => controller);
    await flush();
    const sessionId = controller.sessionId.value;
    // Materialize the original lazy nested proxy before the history clone.
    expect(controller.messages.value[0].toolCalls[0].args.text).toBe("参数");
    controller.newConversation();
    controller.selectConversation(sessionId);
    controller.messages.value[0].toolCalls[0].args.text += "切换后";
    await flush();
    const current = controller.messages.value[0];
    current.toolCalls = [...current.toolCalls];
    await flush();
    current.toolCalls[0].args.text += "替换祖先后";
    await flush();
    expect(full(database, sessionId, "original").toolCalls).toMatchObject([
      { args: { text: "参数切换后替换祖先后" } }
    ]);
  });
  it("updates retained nested references at their current array position after splice", async () => {
    const { database, api } = await storage();
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [
        {
          ...message("active", "回复"),
          processingSteps: [
            { id: "first", type: "response", content: "一", createdAt: date },
            { id: "second", type: "response", content: "二", createdAt: date }
          ]
        }
      ]
    });
    cleanup.push(() => controller.dispose());
    const flush = flushing(api, () => controller);
    await flush();
    const steps = controller.messages.value[0].processingSteps;
    const retained = steps[1];
    if (retained.type !== "response") throw new Error("Expected response");
    steps.splice(0, 1);
    await flush();
    retained.content += "移动后追加";
    await flush();
    expect(
      full(database, controller.sessionId.value, "active").processingSteps
    ).toEqual([
      {
        id: "second",
        type: "response",
        content: "二移动后追加",
        createdAt: date
      }
    ]);
  });
});
