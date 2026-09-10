import { describe, expect, it, vi } from "vitest";
import {
  MODEL_SELECTION_PERSISTENCE_KEY,
  RUN_PREFERENCES_PERSISTENCE_KEY
} from "../stores/conversationStore";
import {
  AGENT_MODEL_SELECTION_STORAGE_KEY,
  AGENT_RUN_PREFERENCES_STORAGE_KEY
} from "./agentRunPreferences";
import {
  conversationHistoryPersistenceKey,
  createConversationPersistenceAdapter,
  legacyConversationHistoryStorageKey
} from "./conversationPersistence";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function snapshot(sessionId: string, content: string, updatedAt: string) {
  return {
    version: 1 as const,
    activeSessionId: sessionId,
    conversations: [
      {
        sessionId,
        messages: [
          {
            id: `user-${sessionId}`,
            role: "user" as const,
            content,
            createdAt: updatedAt,
            status: "completed" as const
          }
        ],
        draft: "",
        approvalMode: "request-approval" as const,
        createdAt: updatedAt,
        updatedAt,
        temperature: 0.7
      }
    ]
  };
}

function memoryApi(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    values,
    load: vi.fn(async (key: string) => values.get(key)),
    save: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
    })
  };
}

describe("conversation persistence adapter", () => {
  it("creates readable contract-safe keys for ordinary conversations", () => {
    expect(conversationHistoryPersistenceKey("long:book 1:setting")).toBe(
      "conversation-history:long%3Abook%201%3Asetting"
    );
  });

  it("bounds long keys while keeping distinct suffixes", () => {
    const left = conversationHistoryPersistenceKey(`book:${"a".repeat(400)}`);
    const right = conversationHistoryPersistenceKey(`book:${"a".repeat(399)}b`);

    expect(left).toHaveLength(240);
    expect(right).toHaveLength(240);
    expect(left).not.toBe(right);
    expect(left).toMatch(/^conversation-history:book%3A.*~[a-f0-9]{16}$/u);
  });

  it("rejects an empty logical key", () => {
    expect(() => conversationHistoryPersistenceKey("   ")).toThrow(
      "会话 key 不能为空"
    );
  });

  it("forwards structured values without serialization", async () => {
    const stored = snapshot(
      "stored",
      "placeholder",
      "2026-09-01T00:00:00.000Z"
    );
    const api = {
      load: vi.fn(async () => stored),
      save: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    };
    const adapter = createConversationPersistenceAdapter(api)!;
    const value = { conversations: [{ messages: ["占位内容"] }] };

    await expect(adapter.load("conversation-history:test")).resolves.toEqual(
      stored
    );
    await adapter.save("conversation-history:test", value);
    await adapter.remove!("conversation-history:test");

    expect(api.save).toHaveBeenCalledWith("conversation-history:test", value);
    expect(api.remove).toHaveBeenCalledWith("conversation-history:test");
  });

  it("returns null when the preload capability is unavailable", () => {
    expect(createConversationPersistenceAdapter(undefined)).toBeNull();
  });

  it("retains a browser history copy containing an unknown record instead of dropping it during migration", async () => {
    const storage = new MemoryStorage();
    const value = snapshot(
      "readable",
      "placeholder",
      "2026-09-01T00:00:00.000Z"
    );
    const original = JSON.stringify({
      ...value,
      conversations: [
        ...value.conversations,
        { sessionId: "legacy", legacyContent: "test original" }
      ]
    });
    const storageKey = legacyConversationHistoryStorageKey("book:plot_design");
    storage.setItem(storageKey, original);
    const api = memoryApi();
    await createConversationPersistenceAdapter(api, { storage })!
      .prepareHistory!("book:chat");
    expect(storage.getItem(storageKey)).toBe(original);
    expect(api.save).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("migrates Chromium localStorage conversations into renderer-state keys", async () => {
    const storage = new MemoryStorage();
    const logicalKey = "book-one:setting";
    const legacy = snapshot(
      "session-old",
      "检查设定冲突",
      "2026-08-14T01:47:00.000Z"
    );
    storage.setItem(
      legacyConversationHistoryStorageKey(logicalKey),
      JSON.stringify(legacy)
    );
    const api = memoryApi();
    const adapter = createConversationPersistenceAdapter(api, { storage })!;
    const persistenceKey = conversationHistoryPersistenceKey(logicalKey);

    await expect(adapter.load(persistenceKey)).resolves.toEqual(legacy);
    expect(
      storage.getItem(legacyConversationHistoryStorageKey(logicalKey))
    ).toBeNull();
    expect(api.values.get(persistenceKey)).toEqual(legacy);
  });

  it("merges leftover localStorage sessions with already-written renderer-state history", async () => {
    const storage = new MemoryStorage();
    const logicalKey = "long:book-1:setting:setting:__book__";
    const persistenceKey = conversationHistoryPersistenceKey(logicalKey);
    storage.setItem(
      legacyConversationHistoryStorageKey(logicalKey),
      JSON.stringify(
        snapshot("session-old", "旧版设定讨论", "2026-08-13T10:00:00.000Z")
      )
    );
    const current = snapshot(
      "session-new",
      "检查设定冲突",
      "2026-08-15T07:51:00.000Z"
    );
    const api = memoryApi({ [persistenceKey]: current });
    const adapter = createConversationPersistenceAdapter(api, { storage })!;

    const loaded = await adapter.load(MODEL_SELECTION_PERSISTENCE_KEY);
    expect(loaded).toBeUndefined();
    const merged = api.values.get(persistenceKey) as {
      conversations: Array<{ sessionId: string }>;
      activeSessionId: string;
    };
    expect(merged.activeSessionId).toBe("session-new");
    expect(merged.conversations.map((item) => item.sessionId)).toEqual([
      "session-new",
      "session-old"
    ]);
    expect(storage.length).toBe(0);
  });

  it("copies missing model selection and fills absent run-preference scopes", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      AGENT_MODEL_SELECTION_STORAGE_KEY,
      JSON.stringify({ selectedModelId: "writer", thinkingLevel: "high" })
    );
    storage.setItem(
      AGENT_RUN_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        general: { temperature: 0.2, approvalMode: "request-approval" },
        "book:one": { temperature: 1.1, approvalMode: "auto-approve" }
      })
    );
    const api = memoryApi({
      [RUN_PREFERENCES_PERSISTENCE_KEY]: {
        general: { temperature: 0.8, approvalMode: "auto-approve" }
      }
    });
    const adapter = createConversationPersistenceAdapter(api, { storage })!;

    await expect(
      adapter.load(MODEL_SELECTION_PERSISTENCE_KEY)
    ).resolves.toEqual({
      selectedModelId: "writer",
      thinkingLevel: "high"
    });
    await expect(
      adapter.load(RUN_PREFERENCES_PERSISTENCE_KEY)
    ).resolves.toEqual({
      general: {
        temperature: 0.8,
        approvalMode: "auto-approve",
        agentTeamMode: "normal"
      },
      "book:one": {
        temperature: 1.1,
        approvalMode: "auto-approve",
        agentTeamMode: "normal"
      }
    });
    expect(storage.length).toBe(0);
  });

  it("does not let an empty restart snapshot erase stored conversations", async () => {
    const logicalKey = "long:book-1:setting:setting:__book__";
    const persistenceKey = conversationHistoryPersistenceKey(logicalKey);
    const current = snapshot(
      "session-kept",
      "检查设定冲突",
      "2026-08-15T07:51:00.000Z"
    );
    const api = memoryApi({ [persistenceKey]: current });
    const adapter = createConversationPersistenceAdapter(api)!;

    await adapter.save(persistenceKey, {
      version: 1,
      activeSessionId: "session-empty",
      conversations: []
    });

    expect(api.save).not.toHaveBeenCalled();
    expect(api.values.get(persistenceKey)).toEqual(current);
  });

  it("retries history saves without evaluation snapshots when the full envelope is rejected", async () => {
    const persistenceKey = conversationHistoryPersistenceKey(
      "book-one:plot_design"
    );
    const envelope = {
      version: 1,
      activeSessionId: "session-eval",
      conversations: [
        {
          sessionId: "session-eval",
          messages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: "已规划剧情点",
              evaluationSnapshot: {
                schemaVersion: 1,
                tools: [
                  {
                    name: "create_plot_design",
                    description: "创建剧情点",
                    inputSchema: { type: "object" }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const api = {
      load: vi.fn(async () => undefined),
      save: vi.fn(async (_key: string, value: unknown) => {
        if (JSON.stringify(value).includes("evaluationSnapshot")) {
          throw new Error(
            "Renderer state item exceeds the 4194304 byte limit."
          );
        }
      }),
      remove: vi.fn(async () => undefined)
    };
    const adapter = createConversationPersistenceAdapter(api)!;

    await adapter.save(persistenceKey, envelope);

    expect(api.save).toHaveBeenCalledTimes(3);
    const persisted = api.save.mock.calls[2]?.[1] as {
      conversations: Array<{ messages: Array<Record<string, unknown>> }>;
    };
    expect(persisted.conversations[0]?.messages[0]).toMatchObject({
      id: "assistant-1",
      content: "已规划剧情点"
    });
    expect(
      persisted.conversations[0]?.messages[0]?.evaluationSnapshot
    ).toBeUndefined();
  });

  it("keeps unreadable localStorage entries so a later launch can retry", async () => {
    const storage = new MemoryStorage();
    const logicalKey = "book-one:plot_design";
    storage.setItem(
      legacyConversationHistoryStorageKey(logicalKey),
      "not-json"
    );
    const api = memoryApi();
    const adapter = createConversationPersistenceAdapter(api, { storage })!;

    await expect(
      adapter.load(conversationHistoryPersistenceKey(logicalKey))
    ).resolves.toBeUndefined();
    expect(
      storage.getItem(legacyConversationHistoryStorageKey(logicalKey))
    ).toBe("not-json");
    expect(api.save).not.toHaveBeenCalled();
  });
});
