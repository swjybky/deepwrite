import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryStageSchema
} from "@deepwrite/contracts";
import { ConversationDatabase } from "./conversation-storage/database";
import { createConversationHistoryWrite } from "../renderer/src/utils/conversationHistoryWriter";
import { createConversationRegistryHistory } from "../renderer/src/composables/conversationRegistryHistory";
import { loadConversationHistoryRecord } from "../renderer/src/utils/conversationHistoryRecordLoader";
import { createConversationPersistenceState } from "../renderer/src/stores/conversationPersistenceState";
import { useAgentConversation } from "../renderer/src/composables/useAgentConversation";
import {
  createDeferredApi,
  document,
  runtime
} from "../renderer/src/composables/useAgentConversation.test-support";

const key = "conversation-history:delete-recovery-integration";
const date = "2026-09-11T00:00:00.000Z";
const cleanup = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
function message(id, content) {
  return { id, content, role: "user", createdAt: date, status: "completed" };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-delete-recovery-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const database = new ConversationDatabase(join(directory, "history.sqlite"));
  cleanup.push(() => database.close());
  const api = {
    commit: vi.fn(async (batch) =>
      database.commit(ConversationHistoryBatchSchema.parse(batch))
    ),
    stage: async (batch) =>
      database.stage(ConversationHistoryStageSchema.parse(batch)),
    session: async (query) => database.session(query),
    list: async (query) => database.list(query),
    messages: async (query) => database.messages(query),
    detail: async (query) => database.detail(query),
    metadataDetail: async (query) => database.metadataDetail(query),
    turns: async (query) => database.turns(query)
  };
  await createConversationHistoryWrite(api, key, {
    revision: 0,
    activeSessionId: "first",
    conversations: ["first", "second"].map((sessionId) => ({
      sessionId,
      metadata: {
        sessionId,
        draft: "",
        approvalMode: "request-approval",
        temperature: 0.7,
        createdAt: date,
        updatedAt: date
      },
      operations: [
        {
          type: "putMessage",
          messageId: `${sessionId}-message`,
          position: 0,
          value: message(`${sessionId}-message`, `${sessionId} content`)
        }
      ]
    }))
  })();
  const history = createConversationRegistryHistory(api, key);
  const state = createConversationPersistenceState();
  let beforeClose;
  state.configurePersistenceAdapter(
    {
      history: api,
      load: async () => undefined,
      save: async () => {
        throw new Error("legacy save should not run");
      },
      onBeforeClose(handler) {
        beforeClose = handler;
        return () => {};
      }
    },
    { debounceMs: 10_000 }
  );
  cleanup.push(() => {
    state.discardPendingPersistence();
    state.disconnect();
  });
  const agent = createDeferredApi();
  const controller = useAgentConversation({
    api: () => agent.api,
    ...history.hooks,
    flushPersistence: (options) => state.flushPersistence(key, options),
    onPersistenceChange: () =>
      state.scheduleControllerPersistence(key, controller)
  });
  cleanup.push(() => controller.dispose());
  await controller.restorePersistenceHistory(
    await history.initialHistory("fallback")
  );
  const originalCommit = api.commit.getMockImplementation();
  let loseDeletion = true;
  let loseOrdinarySession;
  api.commit.mockImplementation(async (batch) => {
    const receipt = await originalCommit(batch);
    if (
      loseDeletion &&
      batch.operations.some((op) => op.type === "setDeleted" && op.deleted)
    ) {
      loseDeletion = false;
      throw new Error("delete receipt lost");
    }
    if (
      batch.sessionId === loseOrdinarySession &&
      batch.operations.some((op) => op.type === "patchMessage")
    ) {
      loseOrdinarySession = undefined;
      throw new Error("ordinary receipt lost");
    }
    return receipt;
  });
  return {
    database,
    api,
    state,
    controller,
    agent,
    close: () => beforeClose(),
    loseOrdinaryAck: (sessionId) => {
      loseOrdinarySession = sessionId;
    },
    read: (sessionId, allowDeleted = false) =>
      loadConversationHistoryRecord(api, key, sessionId, { allowDeleted })
  };
}

describe("pending deletion recovery through the real per-scope queue", () => {
  it("isolates late edits, saves another session with an uncertain ACK, then recovers the late data without clearing or duplicating either session's work", async () => {
    const { database, api, state, controller, read, loseOrdinaryAck, close } =
      await fixture();
    await expect(controller.deleteConversation("first")).rejects.toThrow(
      "delete receipt lost"
    );
    const deletedGeneration = database.session({
      key,
      sessionId: "first"
    }).generation;
    controller.messages.value[0].content += " late append";
    controller.messages.value.push(message("late-user", "late new question"));
    controller.draft.value = "late draft";
    controller.temperature.value = 0.9;
    await expect(state.flushPersistence(key)).rejects.toThrow(
      "删除结果尚未确认"
    );
    expect(state.persistenceProgress.value.get(key).status).toBe("pending");
    expect(state.persistenceBusy.value).toBe(true);
    expect((await read("first", true)).messages[0].content).toBe(
      "first content"
    );
    await expect(close()).rejects.toThrow("删除结果尚未确认");

    expect(await controller.openConversation("second")).toBe(true);
    controller.temperature.value = 0.2;
    controller.messages.value[0].content += " first tail";
    loseOrdinaryAck("second");
    await expect(
      state.flushPersistence(key, { allowDeferred: true })
    ).rejects.toThrow("ordinary receipt lost");
    controller.messages.value[0].content += " second tail";
    // Deletion resolution bypasses the unrelated retry and keeps that exact writer queued.
    expect(await controller.deleteConversation("first")).toBe(true);
    expect(controller.sessionId.value).toBe("second");
    await state.flushPersistence(key);
    await close();
    expect(state.persistenceBusy.value).toBe(false);
    expect(state.persistenceProgress.value.get(key).status).toBe("saved");
    expect(state.persistenceErrors.value.has(key)).toBe(false);
    const recoveredId = controller.history.value.find(
      (item) => !["first", "second"].includes(item.sessionId)
    ).sessionId;
    const recovered = await read(recoveredId);
    expect(recovered.messages.map((value) => value.content)).toEqual([
      "first content late append",
      "late new question"
    ]);
    expect(recovered.draft).toBe("late draft");
    expect(recovered.temperature).toBe(0.9);
    expect((await read("second")).messages[0].content).toBe(
      "second content first tail second tail"
    );
    expect(database.session({ key, sessionId: "first" })).toMatchObject({
      deleted: true,
      generation: deletedGeneration
    });
    const deletionBatches = api.commit.mock.calls.filter(([batch]) =>
      batch.operations.some((op) => op.type === "setDeleted")
    );
    expect(deletionBatches).toHaveLength(2);
    expect(deletionBatches[0][0].batchId).toBe(deletionBatches[1][0].batchId);
    const secondBatches = api.commit.mock.calls.filter(
      ([batch]) =>
        batch.sessionId === "second" &&
        batch.operations.some((op) => op.type === "patchMessage")
    );
    expect(secondBatches[0][0].batchId).toBe(secondBatches[1][0].batchId);
    expect(
      api.commit.mock.calls.filter(
        ([batch]) =>
          batch.sessionId === "first" &&
          batch.operations.some((op) => op.type === "patchMessage")
      )
    ).toEqual([]);
  });

  it("prevents prompts to the isolated identity but permits prompts after switching to another session", async () => {
    const { controller, state, agent } = await fixture();
    await expect(controller.deleteConversation("first")).rejects.toThrow(
      "delete receipt lost"
    );
    controller.draft.value = "late draft";
    expect(controller.canSend.value).toBe(false);
    await controller.sendMessage(document);
    expect(agent.promptCount()).toBe(0);
    expect(controller.draft.value).toBe("late draft");
    expect(await controller.openConversation("second")).toBe(true);
    controller.draft.value = "another session question";
    expect(controller.canSend.value).toBe(true);
    const sending = controller.sendMessage(document);
    await vi.waitFor(() => expect(agent.promptCount()).toBe(1));
    agent.resolveAccepted(0, {
      sessionId: "second",
      runId: "other-session-run",
      acceptedAt: date,
      runtime
    });
    await sending;
    expect(state.persistenceProgress.value.get(key).status).not.toBe("saved");
  });

  it("recovers late edits while still active and strictly blocks exit until deletion resolution and the replacement save are confirmed", async () => {
    const { controller, state, database, read, close } = await fixture();
    await expect(controller.deleteConversation("first")).rejects.toThrow(
      "delete receipt lost"
    );
    controller.draft.value = "keep this draft";
    controller.messages.value[0].content += " keep this append";
    await expect(close()).rejects.toThrow("删除结果尚未确认");
    expect(await controller.deleteConversation("first")).toBe(true);
    const recoveredId = controller.sessionId.value;
    expect(recoveredId).not.toBe("first");
    expect(recoveredId).not.toBe("second");
    await close();
    expect((await read(recoveredId)).draft).toBe("keep this draft");
    expect((await read(recoveredId)).messages[0].content).toBe(
      "first content keep this append"
    );
    expect(database.session({ key, sessionId: "first" }).deleted).toBe(true);
    expect(state.persistenceProgress.value.get(key).status).toBe("saved");
  });

  it("releases isolation when a follow-up database read confirms deletion was rejected", async () => {
    const { controller, database, state, api, read } = await fixture();
    const session = database.session({ key, sessionId: "first" });
    database.commit({
      key,
      sessionId: "first",
      batchId: "mark-running",
      expectedRevision: session.revision,
      generation: session.generation,
      sequence: session.sequence + 1,
      operations: [
        {
          type: "patchMessage",
          messageId: "first-message",
          changes: [{ op: "set", path: ["status"], value: "streaming" }]
        }
      ]
    });
    await expect(controller.deleteConversation("first")).rejects.toThrow(
      "pending review"
    );
    expect(
      controller.capturePersistenceChanges().deferredSessionIds
    ).toBeUndefined();
    controller.draft.value = "ordinary draft still saves";
    await state.flushPersistence(key);
    expect((await read("first")).draft).toBe("ordinary draft still saves");
    expect(database.session({ key, sessionId: "first" }).deleted).toBe(false);
    expect(
      api.commit.mock.calls.some(([batch]) =>
        batch.operations.some((op) => op.type === "setDeleted")
      )
    ).toBe(true);
  });
});
