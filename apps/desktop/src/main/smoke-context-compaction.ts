import type { BrowserWindow } from "electron";
import type {
  ConversationCheckpoint,
  ConversationHistoryJson,
  DeepWriteApi,
  SessionPromptAcceptedPayload,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import { jsonClone } from "@deepwrite/shared";

/** Covers contracts, Preload/Main routing, Utility events and Core persistence. */
async function compactionSmokeInRenderer() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Compaction smoke: ${reason}`);
  };
  const timestamp = new Date().toISOString();
  const history = [
    {
      role: "user" as const,
      content: `不使用梦境结局。${"保留人物动机与因果。".repeat(200)}`,
      createdAt: timestamp,
      runId: "earlier"
    },
    {
      role: "assistant" as const,
      content: "已确认这个要求，当前处于剧情设计阶段。",
      createdAt: timestamp,
      runId: "earlier"
    }
  ];
  async function turn(
    sessionId: string,
    start: () => Promise<SessionPromptAcceptedPayload>
  ) {
    const events: SystemEventEnvelope[] = [];
    let finish!: () => void;
    const terminal = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = api.events.subscribe((event) => {
      if (
        !("sessionId" in event.payload) ||
        event.payload.sessionId !== sessionId
      )
        return;
      events.push(event);
      if (
        event.type === "agent.message_completed" ||
        event.type === "agent.error"
      )
        finish();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const accepted = await start();
      await Promise.race([
        terminal,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("compaction turn timed out")),
            10_000
          );
        })
      ]);
      const failure = events.find((event) => event.type === "agent.error");
      ensure(!failure, JSON.stringify(failure));
      ensure(
        events.some((event) => event.type === "agent.message_completed"),
        "missing reply"
      );
      const compressed = events.find(
        (event) =>
          event.type === "agent.context_compaction" && event.payload.checkpoint
      );
      return {
        accepted,
        compactions: events.filter(
          (event) => event.type === "agent.context_compaction"
        ),
        checkpoint:
          compressed?.type === "agent.context_compaction"
            ? compressed.payload.checkpoint
            : undefined
      };
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
    }
  }
  const sessionId = `smoke_compaction_${Date.now()}`;
  const workspace = await turn(sessionId, () =>
    api.session.prompt({
      sessionId,
      message: "继续设计剧情",
      conversationHistory: history,
      contextCompaction: { instructions: "保留被否决的结局" }
    })
  );
  ensure(
    workspace.checkpoint?.summary.includes("梦境结局"),
    `writing checkpoint lost constraint: ${JSON.stringify(workspace.compactions)}`
  );
  const chatSession = `${sessionId}_chat`;
  const chat = await turn(chatSession, () =>
    api.extrasAgents.run({
      sessionId: chatSession,
      task: { agentId: "chat-normal", profileId: "default", input: {} },
      conversation: { message: "继续讨论", history, compaction: {} }
    })
  );
  ensure(chat.checkpoint, "extras chat did not compact");

  const store = api.conversationPersistence?.history;
  if (!store) throw new Error("Conversation store unavailable");
  const identity = { key: "conversation-history:compaction-smoke", sessionId };
  await store.commit({
    ...identity,
    expectedRevision: 0,
    generation: 0,
    sequence: 1,
    batchId: "checkpoint",
    operations: [
      {
        type: "setMetadata",
        value: { sessionId, createdAt: timestamp, updatedAt: timestamp }
      },
      {
        type: "putMessage",
        messageId: "answer",
        position: 0,
        value: {
          id: "answer",
          role: "assistant",
          content: "剧情设计已完成",
          createdAt: timestamp,
          runId: workspace.accepted.runId,
          contextCompactions: [
            {
              id: "checkpoint",
              status: "completed",
              reason: "manual",
              level: "summary",
              createdAt: timestamp,
              checkpoint: jsonClone(
                workspace.checkpoint
              ) as ConversationHistoryJson
            }
          ]
        }
      }
    ]
  });
  const detail = await store.detail({
    ...identity,
    messageId: "answer",
    path: ["contextCompactions"],
    offset: 0,
    expectedRevision: 1,
    maxBytes: 100_000
  });
  const persisted = JSON.parse(detail.chunk) as Array<{
    checkpoint: ConversationCheckpoint;
  }>;
  ensure(
    persisted[0]?.checkpoint.summary === workspace.checkpoint?.summary,
    "checkpoint persistence changed"
  );
  const restoredSession = `${sessionId}_restored`;
  await turn(restoredSession, () =>
    api.session.prompt({
      sessionId: restoredSession,
      message: "现在开始编写正文",
      conversationCheckpoint: persisted[0]!.checkpoint,
      conversationHistory: [
        {
          role: "user",
          content: "继续设计剧情",
          createdAt: timestamp,
          runId: workspace.accepted.runId
        }
      ]
    })
  );
  return {
    status: "ok",
    workspace: true,
    chat: true,
    persisted: true,
    coldRestore: true
  };
}

export function runContextCompactionSmoke(window: BrowserWindow) {
  return window.webContents.executeJavaScript(
    `(${compactionSmokeInRenderer.toString()})()`
  );
}
