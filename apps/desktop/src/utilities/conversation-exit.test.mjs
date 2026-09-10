import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererStateStore } from "./renderer-state-store.ts";
import { createConversationPersistenceAdapter } from "../renderer/src/utils/conversationPersistence.ts";
import { conversationHistoryPersistenceKey } from "../renderer/src/utils/conversationPersistenceKeys.ts";
import { useConversationStore } from "../renderer/src/stores/conversationStore.ts";
import {
  createDeferredApi,
  createEnvelope,
  document,
  runtime,
  useAgentConversation
} from "../renderer/src/composables/useAgentConversation.test-support.ts";

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "deepwrite-child-close-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const disk = new RendererStateStore(directory);
  setActivePinia(createPinia());
  const store = useConversationStore();
  let close;
  store.configurePersistenceAdapter(
    createConversationPersistenceAdapter({
      onBeforeClose(handler) {
        close = handler;
        return () => undefined;
      },
      load: (key) => disk.load(key),
      save: (key, value) => disk.save(key, value),
      remove: (key) => disk.remove(key),
      migrateHistory: (input) => disk.migrateHistory(input),
      listHistoryKeys: () => disk.listHistoryKeys()
    })
  );
  cleanups.push(() => store.dispose());
  const api = createDeferredApi();
  const key = conversationHistoryPersistenceKey("book:child-close");
  const conversation = useAgentConversation({
    api: () => api.api,
    initialMessages: Array.from({ length: 25 }, (_, index) => [
      {
        id: `user-${index}`,
        role: "user",
        content: `第 ${index + 1} 轮问题`,
        createdAt: "2026-09-10T00:00:00.000Z"
      },
      {
        id: `assistant-${index}`,
        role: "assistant",
        content: `第 ${index + 1} 轮回复`,
        status: "completed",
        createdAt: "2026-09-10T00:00:01.000Z"
      }
    ]).flat(),
    onPersistenceChange: () =>
      store.schedulePersistenceFactory(
        key,
        conversation.capturePersistenceSnapshot
      )
  });
  store.registerController("book:child-close", "general", conversation);
  conversation.draft.value = "建立世界观";
  const sending = conversation.sendMessage(document);
  const sessionId = conversation.sessionId.value;
  const runId = "run-child-close";
  api.resolveAccepted(0, {
    sessionId,
    runId,
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  const child = {
    sessionId,
    runId,
    parentToolCallId: "spawn-child",
    subagentRunId: "child-close",
    subagentId: "writer",
    name: "写手",
    runtime
  };
  conversation.handleEvent(
    createEnvelope(
      "subagent.started",
      {
        ...child,
        task: "编写世界观规则"
      },
      { id: "child-started", context: { sessionId, runId } }
    )
  );
  conversation.handleEvent(
    createEnvelope(
      "subagent.activity",
      {
        ...child,
        activity: { type: "message_delta", delta: "已经生成的世界观规则" }
      },
      { id: "child-output", context: { sessionId, runId } }
    )
  );
  return { conversation, api, close: () => close(), directory, key, child };
}

describe("stopping and closing a delegated conversation", () => {
  it("settles the parent and its child on abort acknowledgement even if the terminal event is missing", async () => {
    const h = await harness();
    await h.conversation.stopGeneration();
    expect(h.api.aborts).toEqual([
      {
        sessionId: h.child.sessionId,
        runId: h.child.runId
      }
    ]);
    expect(h.conversation.isBusy.value).toBe(false);
    expect(
      h.conversation.messages.value.at(-1)?.subagentRuns?.[0]
    ).toMatchObject({
      status: "stopped",
      output: "已经生成的世界观规则"
    });
  });

  it("stops a running child and reloads the complete conversation from disk after a normal exit", async () => {
    const h = await harness();
    await h.close();
    expect(h.api.aborts).toHaveLength(1);
    const restored = useAgentConversation({
      api: () => undefined,
      initialPersistenceSnapshot: await new RendererStateStore(
        h.directory
      ).load(h.key)
    });
    cleanups.push(async () => restored.dispose());
    expect(restored.messages.value).toHaveLength(52);
    expect(restored.messages.value[0]?.content).toBe("第 1 轮问题");
    expect(restored.messages.value[49]?.content).toBe("第 25 轮回复");
    expect(restored.messages.value[50]?.content).toBe("建立世界观");
    expect(restored.messages.value.at(-1)?.subagentRuns?.[0]).toMatchObject({
      status: "stopped",
      output: "已经生成的世界观规则"
    });
  });
});
