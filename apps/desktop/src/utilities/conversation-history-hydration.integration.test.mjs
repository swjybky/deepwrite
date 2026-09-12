import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryStageSchema
} from "@deepwrite/contracts";
import { ConversationDatabase } from "./conversation-storage/database";
import { createConversationPersistenceState } from "../renderer/src/stores/conversationPersistenceState";
import { loadConversationHistoryRecord } from "../renderer/src/utils/conversationHistoryRecordLoader";
import { useAgentConversation } from "../renderer/src/composables/useAgentConversation";
import {
  createDeferredApi,
  runtime
} from "../renderer/src/composables/useAgentConversation.test-support";

const key = "conversation-history:hydration-integration";
const date = "2026-09-11T00:00:00.000Z";
const cleanup = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it("saves a reply and draft received after the user-message ACK while hydration holds automatic writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-hydration-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const database = new ConversationDatabase(join(directory, "history.sqlite"));
  cleanup.push(() => database.close());
  const history = {
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
  const state = createConversationPersistenceState();
  let beforeClose;
  state.configurePersistenceAdapter(
    {
      history,
      load: async () => undefined,
      save: async () => {
        throw new Error("Unexpected legacy save");
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
  const schedule = vi.fn(() =>
    state.scheduleControllerPersistence(key, controller)
  );
  const controller = useAgentConversation({
    api: () => agent.api,
    onPersistenceChange: schedule,
    flushPersistence: async (options) => {
      schedule();
      await state.flushPersistence(key, options);
    }
  });
  cleanup.push(() => controller.dispose());
  const sessionId = controller.sessionId.value;
  controller.holdPersistenceEmits();
  controller.draft.value = "历史读取期间发送的问题";
  const sending = controller.sendAssistantMessage();
  await vi.waitFor(() => expect(agent.promptCount()).toBe(1));
  const savedUser = database.messages({ key, sessionId });
  expect(savedUser.messages).toHaveLength(1);
  expect(savedUser.messages[0].value.content).toBe("历史读取期间发送的问题");
  agent.resolveAccepted(0, {
    sessionId,
    runId: "hydration-run",
    acceptedAt: date,
    runtime
  });
  await sending;
  controller.handleEvent({
    id: "hydration-completed",
    type: "agent.message_completed",
    timestamp: date,
    payload: {
      sessionId,
      runId: "hydration-run",
      messageId: "hydration-answer",
      content: "历史仍在读取时返回的完整回复",
      runtime
    }
  });
  controller.draft.value = "回复之后继续输入的草稿";
  expect(controller.messages.value).toHaveLength(2);
  expect(schedule).toHaveBeenCalledOnce();
  expect(database.messages({ key, sessionId }).messages).toHaveLength(1);

  // A late initial read cannot replace the already acknowledged local session.
  expect(
    await controller.restorePersistenceHistory({
      activeSessionId: "earlier-session",
      items: []
    })
  ).toBe(false);
  controller.releasePersistenceEmits();
  expect(schedule).toHaveBeenCalledTimes(2);
  expect(state.persistenceBusy.value).toBe(true);
  await beforeClose();
  expect(state.persistenceBusy.value).toBe(false);
  const restored = await loadConversationHistoryRecord(history, key, sessionId);
  expect(restored.messages.map((message) => message.content)).toEqual([
    "历史读取期间发送的问题",
    "历史仍在读取时返回的完整回复"
  ]);
  expect(restored.draft).toBe("回复之后继续输入的草稿");
  expect(controller.capturePersistenceChanges().conversations).toEqual([]);
});
