import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as contracts from "@deepwrite/contracts";
import { ConversationDatabase } from "./conversation-storage/database";
import { JsonNodes } from "./conversation-storage/json-nodes";
import { createConversationHistoryWrite } from "../renderer/src/utils/conversationHistoryWriter";
import { loadConversationHistoryRecord } from "../renderer/src/utils/conversationHistoryRecordLoader";
import { createConversationRegistryHistory } from "../renderer/src/composables/conversationRegistryHistory";
import { useAgentConversation } from "../renderer/src/composables/useAgentConversation";

const key = "conversation-history:reader-integration";
const date = "2026-09-11T00:00:00.000Z";
const cleanup = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
function message(id, content, role = "user") {
  return { id, role, content, createdAt: date, status: "completed" };
}
function metadata(sessionId, draft = "") {
  return {
    sessionId,
    draft,
    approvalMode: "request-approval",
    temperature: 0.7,
    createdAt: date,
    updatedAt: date,
    unknownMetadata: { preserve: true }
  };
}

async function storage() {
  const directory = await mkdtemp(
    join(tmpdir(), "deepwrite-reader-integration-")
  );
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const database = new ConversationDatabase(join(directory, "history.sqlite"));
  cleanup.push(() => database.close());
  const names = {
    commit: ["Batch", "CommitResult"],
    stage: ["Stage", "StageResult"],
    session: ["SessionQuery", "Session"],
    list: ["ListQuery", "ListResult"],
    messages: ["MessagesQuery", "MessagesResult"],
    detail: ["DetailQuery", "DetailResult"],
    metadataDetail: ["MetadataDetailQuery", "DetailResult"],
    turns: ["TurnsQuery", "TurnsResult"]
  };
  const api = {};
  for (const [method, [input, output]] of Object.entries(names)) {
    api[method] = vi.fn(async (raw) => {
      const query = contracts[`ConversationHistory${input}Schema`].parse(raw);
      const value = database[method](query);
      const schema = contracts[`ConversationHistory${output}Schema`];
      const result = (method === "session" ? schema.nullable() : schema).parse(
        value
      );
      if (result && query.maxBytes) {
        const bytes =
          method.endsWith("Detail") || method === "detail"
            ? Buffer.byteLength(result.chunk)
            : Buffer.byteLength(JSON.stringify(result));
        expect(bytes).toBeLessThanOrEqual(query.maxBytes);
      }
      return result;
    });
  }
  return { database, api };
}
async function seed(api, records, activeSessionId = records[0].sessionId) {
  await createConversationHistoryWrite(api, key, {
    revision: 0,
    activeSessionId,
    conversations: records.map((record) => ({
      sessionId: record.sessionId,
      metadata: record.metadata ?? metadata(record.sessionId, record.draft),
      operations: record.messages.map((value, position) => ({
        type: "putMessage",
        messageId: value.id,
        position,
        value
      }))
    }))
  })();
}
function controllerFor(api, history) {
  let controller;
  let pending;
  const flush = async () => {
    for (;;) {
      if (!pending) {
        const changes = controller.capturePersistenceChanges();
        if (!changes.conversations.length) return;
        pending = {
          revision: changes.revision,
          write: createConversationHistoryWrite(api, key, changes)
        };
      }
      await pending.write();
      controller.acknowledgePersistenceChanges(pending.revision);
      pending = undefined;
    }
  };
  controller = useAgentConversation({
    api: () => undefined,
    ...history.hooks,
    flushPersistence: flush
  });
  cleanup.push(() => controller.dispose());
  return { controller, flush };
}
async function smallDetail(api, sessionId, messageId, path) {
  const session = await api.session({ key, sessionId });
  const result = await api.detail({
    key,
    sessionId,
    messageId,
    path,
    expectedRevision: session.revision,
    maxBytes: 4096
  });
  expect(result.nextOffset).toBeNull();
  return result.encoding === "text" ? result.chunk : JSON.parse(result.chunk);
}

describe("real history read, controller and management integration", () => {
  it("loads only the active session, then restores multi-page drafts/tools and preserves unknown fields through edits/deletion/restoration", async () => {
    const { database, api } = await storage();
    const draft = "草稿 line\n".repeat(140_000);
    const text = "tool line\n".repeat(240_000);
    const large = {
      ...message("large-message", "large question"),
      unknownMessage: { preserve: "unchanged" },
      toolCalls: [
        {
          id: "tool",
          name: "test_tool",
          args: { text },
          argumentsText: text,
          status: "completed",
          requestedAt: date,
          completedAt: date
        }
      ]
    };
    await seed(api, [
      {
        sessionId: "active",
        messages: [message("active-message", "active question")]
      },
      { sessionId: "large", draft, messages: [large] }
    ]);
    api.detail.mockClear();
    const reads = vi.spyOn(JsonNodes.prototype, "read");
    const history = createConversationRegistryHistory(api, key);
    const { controller, flush } = controllerFor(api, history);
    await controller.restorePersistenceHistory(
      await history.initialHistory("fallback")
    );
    expect(controller.sessionId.value).toBe("active");
    expect(
      controller.history.value.find((item) => item.sessionId === "large")
    ).toMatchObject({
      title: "large question",
      preview: "large question",
      turnCount: 1
    });
    expect(controller.capturePersistenceSnapshot().conversations).toHaveLength(
      1
    );
    expect(
      api.detail.mock.calls.every(([query]) => query.sessionId === "active")
    ).toBe(true);
    expect(reads.mock.calls.every(([ref]) => ref.bytes < 4096)).toBe(true);
    reads.mockRestore();
    expect(await controller.openConversation("large")).toBe(true);
    expect(controller.draft.value).toBe(draft);
    expect(controller.messages.value[0].toolCalls[0].argumentsText).toBe(text);
    expect(controller.messages.value[0].toolCalls[0].args.text).toBe(text);
    expect(
      api.detail.mock.calls.filter(([query]) => query.sessionId === "large")
        .length
    ).toBeGreaterThan(2);
    controller.messages.value[0].content += " appended";
    await flush();
    expect(
      await smallDetail(api, "large", "large-message", ["unknownMessage"])
    ).toEqual({ preserve: "unchanged" });
    const beforeDelete = database.session({ key, sessionId: "large" });
    expect(await controller.deleteConversation("large")).toBe(true);
    expect(
      database.session({ key, sessionId: "large" }).generation
    ).toBeGreaterThan(beforeDelete.generation);
    expect(controller.sessionId.value).toBe("active");
    expect(await controller.listDeletedConversations()).toHaveLength(1);
    expect(await controller.restoreConversation("large")).toBe(true);
    expect(await controller.openConversation("large")).toBe(true);
    expect(controller.draft.value).toBe(draft);
    expect(controller.messages.value[0].toolCalls[0].args.text).toBe(text);
    expect(
      await smallDetail(api, "large", "large-message", ["unknownMessage"])
    ).toEqual({ preserve: "unchanged" });
    const session = await api.session({ key, sessionId: "large" });
    expect(
      (
        await api.metadataDetail({
          key,
          sessionId: "large",
          path: ["unknownMetadata"],
          expectedRevision: session.revision
        })
      ).chunk
    ).toBe('{"preserve":true}');
  });

  it("retries lost management acknowledgements with the same batches and applies each generation only once", async () => {
    const { database, api } = await storage();
    await seed(api, [
      { sessionId: "active", messages: [message("a", "active")] },
      { sessionId: "other", messages: [message("b", "other")] }
    ]);
    const history = createConversationRegistryHistory(api, key);
    const { controller } = controllerFor(api, history);
    await controller.restorePersistenceHistory(
      await history.initialHistory("fallback")
    );
    const original = api.commit.getMockImplementation();
    let lose = true;
    api.commit.mockImplementation(async (batch) => {
      const receipt = await original(batch);
      if (lose && batch.operations.some((op) => op.type === "setDeleted")) {
        lose = false;
        throw new Error("acknowledgement lost");
      }
      return receipt;
    });
    await expect(controller.deleteConversation("other")).rejects.toThrow(
      "acknowledgement lost"
    );
    const deletedGeneration = database.session({
      key,
      sessionId: "other"
    }).generation;
    expect(await controller.deleteConversation("other")).toBe(true);
    expect(database.session({ key, sessionId: "other" }).generation).toBe(
      deletedGeneration
    );
    lose = true;
    await expect(controller.restoreConversation("other")).rejects.toThrow(
      "acknowledgement lost"
    );
    const restoredGeneration = database.session({
      key,
      sessionId: "other"
    }).generation;
    expect(await controller.restoreConversation("other")).toBe(true);
    expect(database.session({ key, sessionId: "other" }).generation).toBe(
      restoredGeneration
    );
    const ids = api.commit.mock.calls
      .filter(([batch]) =>
        batch.operations.some((op) => op.type === "setDeleted")
      )
      .map(([batch]) => batch.batchId);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).toBe(ids[3]);
  });

  it("prepares a fresh deletion after a busy rejection and a later state update", async () => {
    const { database, api } = await storage();
    await seed(api, [
      {
        sessionId: "active",
        messages: [{ ...message("running", "running"), status: "streaming" }]
      }
    ]);
    const history = createConversationRegistryHistory(api, key);
    await expect(
      history.hooks.historyManagement.delete("active")
    ).rejects.toThrow("pending review");
    const session = database.session({ key, sessionId: "active" });
    await api.commit({
      key,
      sessionId: "active",
      batchId: "finish-running",
      expectedRevision: session.revision,
      generation: session.generation,
      sequence: session.sequence + 1,
      operations: [
        {
          type: "patchMessage",
          messageId: "running",
          changes: [{ op: "set", path: ["status"], value: "completed" }]
        }
      ]
    });
    await history.hooks.historyManagement.delete("active");
    expect(database.session({ key, sessionId: "active" }).deleted).toBe(true);
    const management = api.commit.mock.calls.filter(([batch]) =>
      batch.operations.some((op) => op.type === "setDeleted")
    );
    expect(management[0][0].batchId).not.toBe(management[1][0].batchId);
  });

  it("discards a conflicting active load while preserving a new local draft", async () => {
    const { database, api } = await storage();
    await seed(api, [
      {
        sessionId: "active",
        messages: Array.from({ length: 101 }, (_, index) =>
          message(`message-${index}`, `question ${index}`)
        )
      }
    ]);
    const history = createConversationRegistryHistory(api, key);
    const { controller } = controllerFor(api, history);
    const original = api.messages.getMockImplementation();
    api.messages.mockImplementation(async (query) => {
      if (query.afterPosition !== undefined) {
        const session = database.session({ key, sessionId: "active" });
        database.commit({
          key,
          sessionId: "active",
          batchId: "concurrent-change",
          expectedRevision: session.revision,
          generation: session.generation,
          sequence: session.sequence + 1,
          operations: [
            {
              type: "setMetadata",
              value: { updatedAt: "2026-09-11T02:00:00.000Z" }
            }
          ]
        });
      }
      return original(query);
    });
    const restore = history
      .initialHistory("fallback")
      .then(controller.restorePersistenceHistory);
    controller.draft.value = "new local draft";
    await expect(restore).rejects.toThrow("changed while reading");
    expect(controller.draft.value).toBe("new local draft");
    expect(controller.messages.value).toEqual([]);
    expect(
      controller
        .capturePersistenceChanges()
        .conversations.map((value) => value.sessionId)
    ).not.toContain("active");
  });

  // Thousands of SQLite nodes plus budgeted IPC reads contend with other disk tests.
  it("materializes root message references and obtains dates without loading unknown root metadata", async () => {
    const { api } = await storage();
    const unknown = Object.fromEntries(
      Array.from({ length: 1800 }, (_, index) => [
        `unknown-${index}`,
        "unrecognized"
      ])
    );
    await seed(api, [
      {
        sessionId: "active",
        metadata: { ...metadata("active"), ...unknown },
        messages: [{ ...message("a", "root fallback"), ...unknown }]
      }
    ]);
    // Force the budget fallback paths using real query/response schema validation.
    const originalMessages = api.messages.getMockImplementation();
    api.messages.mockImplementation((query) =>
      originalMessages({ ...query, maxBytes: 1024 })
    );
    const originalList = api.list.getMockImplementation();
    api.list.mockImplementation((query) =>
      originalList({ ...query, maxBytes: 4096 })
    );
    const history = createConversationRegistryHistory(api, key);
    const result = await history.initialHistory("fallback");
    expect(result.items[0].title).toBe("root fallback");
    expect(result.active.messages[0].content).toBe("root fallback");
    expect(
      api.metadataDetail.mock.calls.some(
        ([query]) => query.path[0] === "createdAt"
      )
    ).toBe(true);
    expect(
      api.detail.mock.calls.some(([query]) => query.path.length === 0)
    ).toBe(true);
    const read = await loadConversationHistoryRecord(api, key, "active");
    expect(read.messages[0].id).toBe("a");
  }, 30_000);
});
