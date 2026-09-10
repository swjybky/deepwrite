import { describe, expect, it, vi } from "vitest";
import {
  createConversationPersistenceAdapter,
  conversationHistoryPersistenceKey,
  legacyConversationHistoryStorageKey
} from "./conversationPersistence";
import { migrateBookConversationHistory } from "./bookConversationMigration";
import type { AgentConversationPersistenceSnapshot } from "../composables/useAgentConversation";

const key = conversationHistoryPersistenceKey;
function snapshot(
  sessionId: string,
  minute = 0,
  content = sessionId
): AgentConversationPersistenceSnapshot {
  const timestamp = new Date(Date.UTC(2026, 8, 1, 0, minute)).toISOString();
  return {
    version: 1,
    activeSessionId: sessionId,
    conversations: [
      {
        sessionId,
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [
          {
            id: `user-${sessionId}`,
            role: "user",
            content,
            createdAt: timestamp,
            status: "completed"
          }
        ],
        draft: "",
        approvalMode: "request-approval",
        temperature: 0.7
      }
    ]
  };
}
function memoryApi(initial: Record<string, unknown>) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    listHistoryKeys: vi.fn(async () => [...values.keys()]),
    load: vi.fn(async (key: string) => values.get(key)),
    save: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    migrateHistory: vi.fn(
      async (
        input: import("@deepwrite/contracts").RendererStateHistoryMigration
      ) => {
        const current = values.get(input.key);
        if (
          JSON.stringify(current) !==
            JSON.stringify(
              input.expected.found ? input.expected.value : undefined
            ) ||
          input.sources.some(
            (source) =>
              JSON.stringify(values.get(source.key)) !==
              JSON.stringify(source.value)
          )
        )
          return false;
        values.set(input.key, input.value);
        for (const source of input.sources) values.delete(source.key);
        return true;
      }
    ),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
    })
  };
}

describe("book conversation migration", () => {
  it.each(["short-one", "script-one"])(
    "merges all stages, sections and general history for %s",
    async (book) => {
      const api = memoryApi({
        [key(`${book}:character_design`)]: snapshot("character", 1),
        [key(`${book}:plot_design`)]: snapshot("plot", 2),
        [key(`${book}:expert_draft_coordinator`)]: snapshot("draft", 3),
        [key(`${book}:expert_section_writer:old-section`)]: snapshot(
          "section",
          4
        ),
        [key(`${book}:general`)]: snapshot("general", 5),
        [key("another-book:plot_design")]: snapshot("other", 6)
      });
      const adapter = createConversationPersistenceAdapter(api)!;
      await Promise.all([
        adapter.prepareHistory!(`${book}:chat`),
        adapter.prepareHistory!(`${book}:chat`)
      ]);
      const result = (await adapter.load(
        key(`${book}:chat`)
      )) as AgentConversationPersistenceSnapshot;
      expect(result.conversations.map(({ sessionId }) => sessionId)).toEqual([
        "general",
        "section",
        "draft",
        "plot",
        "character"
      ]);
      expect(api.values.size).toBe(2);
      expect(api.values.has(key("another-book:plot_design"))).toBe(true);
      expect(api.listHistoryKeys).toHaveBeenCalledTimes(1);
      const saves = api.migrateHistory.mock.calls.length;
      await createConversationPersistenceAdapter(api)!.prepareHistory!(
        `${book}:chat`
      );
      expect(api.migrateHistory.mock.calls).toHaveLength(saves);
    }
  );

  it("merges long stages and per-chapter ledger history, including removed chapters", async () => {
    const api = memoryApi(
      Object.fromEntries(
        [
          "worldbuilding:__book__",
          "character_design:__book__",
          "plot_design:__book__",
          "draft:__book__",
          "continuity_ledger:__book__",
          "continuity_ledger:removed-chapter"
        ].map((lane, index) => [
          key(`long:book%3Aone:${lane}`),
          snapshot(lane, index)
        ])
      )
    );
    api.values.set(
      key("long:book%3Atwo:draft:__book__"),
      snapshot("other", 10)
    );
    await migrateBookConversationHistory(api, "long:book%3Aone:chat");
    const result = api.values.get(
      key("long:book%3Aone:chat")
    ) as AgentConversationPersistenceSnapshot;
    expect(result.conversations).toHaveLength(6);
    expect(result.activeSessionId).toBe("continuity_ledger:removed-chapter");
    expect(api.values.size).toBe(2);
  });

  it("deduplicates sessions by their latest update without dropping older history", async () => {
    const target = snapshot("old-selected", 0);
    const api = memoryApi({ [key("book:chat")]: target });
    for (let lane = 0; lane < 3; lane++) {
      const value = snapshot(`session-${lane * 20}`);
      value.conversations = Array.from(
        { length: 20 },
        (_, index) =>
          snapshot(`session-${lane * 20 + index}`, lane * 20 + index + 1)
            .conversations[0]!
      );
      api.values.set(
        key(
          `book:${["character_design", "plot_design", "expert_draft_coordinator"][lane]}`
        ),
        value
      );
    }
    api.values.set(
      key("book:general"),
      snapshot("session-59", 70, "updated duplicate")
    );
    await migrateBookConversationHistory(api, "book:chat");
    const result = api.values.get(
      key("book:chat")
    ) as AgentConversationPersistenceSnapshot;
    expect(result.conversations).toHaveLength(61);
    expect(
      new Set(result.conversations.map(({ sessionId }) => sessionId)).size
    ).toBe(61);
    expect(result.activeSessionId).toBe("old-selected");
    expect(result.conversations[0]?.messages[0]?.content).toBe(
      "updated duplicate"
    );
    expect(result.conversations.at(-1)?.sessionId).toBe("old-selected");
  });

  it("retains sources when saving fails and safely retries", async () => {
    const sourceKey = key("book:plot_design");
    const api = memoryApi({ [sourceKey]: snapshot("legacy") });
    api.migrateHistory.mockRejectedValueOnce(
      new Error("test disk unavailable")
    );
    const adapter = createConversationPersistenceAdapter(api)!;
    await expect(adapter.prepareHistory!("book:chat")).rejects.toThrow(
      "test disk unavailable"
    );
    expect(api.values.has(sourceKey)).toBe(true);
    expect(api.remove).not.toHaveBeenCalled();
    await adapter.prepareHistory!("book:chat");
    expect(api.values.has(sourceKey)).toBe(false);
    expect(api.values.has(key("book:chat"))).toBe(true);
  });

  it("retries an interrupted atomic migration without duplicating or losing history", async () => {
    const api = memoryApi({
      [key("book:plot_design")]: snapshot("plot"),
      [key("book:character_design")]: snapshot("character", 1)
    });
    api.migrateHistory.mockRejectedValueOnce(
      new Error("test cleanup interrupted")
    );
    await expect(
      migrateBookConversationHistory(api, "book:chat")
    ).rejects.toThrow();
    await migrateBookConversationHistory(api, "book:chat");
    expect(
      (api.values.get(key("book:chat")) as AgentConversationPersistenceSnapshot)
        .conversations
    ).toHaveLength(2);
    expect(api.values.size).toBe(1);
  });

  it("preserves unreadable records while migrating readable sources", async () => {
    const corrupt = {
      ...snapshot("broken"),
      conversations: [{ sessionId: "broken" }]
    };
    const api = memoryApi({
      [key("book:plot_design")]: corrupt,
      [key("book:general")]: snapshot("valid")
    });
    await migrateBookConversationHistory(api, "book:chat");
    expect(api.values.get(key("book:plot_design"))).toBe(corrupt);
    expect(
      (api.values.get(key("book:chat")) as AgentConversationPersistenceSnapshot)
        .conversations[0]?.sessionId
    ).toBe("valid");
  });

  it("finds hashed legacy stage keys for long filesystem-derived book identities", async () => {
    const book = `/test-workspace/${"book".repeat(140)}`;
    const api = memoryApi({ [key(`${book}:plot_design`)]: snapshot("legacy") });
    await migrateBookConversationHistory(api, `${book}:chat`);
    expect(api.values.has(key(`${book}:chat`))).toBe(true);
    expect(api.values.size).toBe(1);
  });

  it("includes old long-book stage keys without a child suffix", async () => {
    const api = memoryApi({
      [key("long:book:setting")]: snapshot("setting"),
      [key("long:book:plot_design")]: snapshot("plot", 1),
      [key("long:book:chat")]: snapshot("current", 2)
    });
    await migrateBookConversationHistory(api, "long:book:chat");
    expect(
      (
        api.values.get(
          key("long:book:chat")
        ) as AgentConversationPersistenceSnapshot
      ).conversations.map((record) => record.sessionId)
    ).toEqual(["current", "plot", "setting"]);
    expect(api.values.size).toBe(1);
  });

  it("retains original sources when an older API cannot migrate atomically", async () => {
    const api = memoryApi({ [key("book:plot_design")]: snapshot("original") });
    const { migrateHistory: _migration, ...legacyApi } = api;
    await migrateBookConversationHistory(legacyApi, "book:chat");
    expect(api.values.has(key("book:plot_design"))).toBe(true);
    expect(api.values.has(key("book:chat"))).toBe(true);
    expect(api.remove).not.toHaveBeenCalled();
  });

  it("migrates browser history before collecting the book's persisted stages", async () => {
    const storageKey = legacyConversationHistoryStorageKey(
      "book:character_design"
    );
    const storage = {
      length: 1,
      key: () => storageKey,
      getItem: () => JSON.stringify(snapshot("browser-history")),
      removeItem: vi.fn()
    };
    const api = memoryApi({});
    const adapter = createConversationPersistenceAdapter(api, { storage })!;
    await adapter.prepareHistory!("book:chat");
    expect(
      (
        (await adapter.load(
          key("book:chat")
        )) as AgentConversationPersistenceSnapshot
      ).conversations[0]?.sessionId
    ).toBe("browser-history");
    expect(storage.removeItem).toHaveBeenCalledWith(storageKey);
    expect(api.values.size).toBe(1);
  });
});
