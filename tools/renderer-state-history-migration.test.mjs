import { RendererStateKeySchema } from "../packages/contracts/src/renderer-state";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TestRendererStateStore as RendererStateStore,
  closeRendererStateTestStores
} from "../apps/desktop/src/utilities/renderer-state-store.test-support";
import { DatabaseSync } from "node:sqlite";
import { JsonNodes } from "../apps/desktop/src/utilities/conversation-storage/json-nodes";
import { Statements } from "../apps/desktop/src/utilities/conversation-storage/schema";
import {
  createConversationPersistenceAdapter,
  conversationHistoryPersistenceKey as key
} from "../apps/desktop/src/renderer/src/utils/conversationPersistence";
const roots = [];
afterEach(async () => {
  await closeRendererStateTestStores();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
function snapshot(sessionId, length = 30) {
  const date = "2026-09-01T00:00:00.000Z";
  return {
    version: 1,
    activeSessionId: sessionId,
    conversations: [
      {
        sessionId,
        messages: [
          {
            id: sessionId,
            role: "user",
            content: "x".repeat(length),
            createdAt: date,
            status: "completed"
          }
        ],
        draft: "",
        approvalMode: "request-approval",
        createdAt: date,
        updatedAt: date,
        temperature: 0.7
      }
    ]
  };
}
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-history-migration-"));
  roots.push(root);
  if (options.legacyEntries) {
    await mkdir(join(root, "renderer-state"));
    await writeFile(
      join(root, "renderer-state/conversation-persistence.json"),
      JSON.stringify({ version: 1, entries: options.legacyEntries })
    );
  }
  const store = new RendererStateStore(root);
  const api = {
    listHistoryKeys: () => store.listHistoryKeys(),
    load: (key2) => store.load(key2),
    save: (key2, value) => store.save(key2, value),
    remove: (key2) => store.remove(key2),
    migrateHistory: (input) => store.migrateHistory(input)
  };
  return { root, store, api };
}
function sessions(value) {
  return value.conversations.map((record) => record.sessionId).sort();
}
describe("book history migration with disk persistence", () => {
  it("never cuts a percent escape in long encoded book identities", () => {
    for (let length = 20; length < 50; length++) {
      const persistenceKey = key(`/test-workspace/${"书".repeat(length)}:chat`);
      expect(persistenceKey.length).toBeLessThanOrEqual(240);
      expect(RendererStateKeySchema.safeParse(persistenceKey).success).toBe(
        true
      );
    }
  });

  it("refuses to replace a target containing unreadable records", async () => {
    const original = {
      version: 1,
      activeSessionId: "old",
      conversations: [{ sessionId: "old", legacyContent: "test original" }]
    };
    const { store, api } = await fixture({
      legacyEntries: { [key("book:chat")]: original }
    });
    const adapter = createConversationPersistenceAdapter(api);
    await expect(adapter.load(key("book:chat"))).rejects.toThrow();
    await expect(
      adapter.save(key("book:chat"), snapshot("new"))
    ).rejects.toThrow();
    await store.save(key("book:plot_design"), snapshot("plot"));
    await expect(adapter.prepareHistory("book:chat")).rejects.toThrow();
    await expect(
      adapter.save(key("book:chat"), snapshot("new"))
    ).rejects.toThrow();
    expect(await store.load(key("book:chat"))).toEqual(original);
    expect(sessions(await store.load(key("book:plot_design")))).toEqual([
      "plot"
    ]);
  });
  it("merges more than 8 MiB and keeps exact originals in a separate backup", async () => {
    const { root, store, api } = await fixture();
    const plot = snapshot("plot", 46e5);
    const character = snapshot("character", 46e5);
    await store.save(key("book:plot_design"), plot);
    await store.save(key("book:character_design"), character);
    await createConversationPersistenceAdapter(api).prepareHistory("book:chat");
    const reloaded = new RendererStateStore(root);
    expect(sessions(await reloaded.load(key("book:chat")))).toEqual([
      "character",
      "plot"
    ]);
    expect(await reloaded.listHistoryKeys()).toEqual([key("book:chat")]);
    const connection = new DatabaseSync(store.statePath);
    try {
      const nodes = new JsonNodes(new Statements(connection));
      const backups = connection
        .prepare("SELECT key, value_ref FROM legacy_backups")
        .all();
      const restored = Object.fromEntries(
        backups.map((row) => [row.key, nodes.read(JSON.parse(row.value_ref))])
      );
      expect(restored).toEqual({
        [key("book:plot_design")]: plot,
        [key("book:character_design")]: character
      });
    } finally {
      connection.close();
    }
  });
  it("consolidates source keys while keeping both independent histories", async () => {
    const { root, store, api } = await fixture();
    await store.save(key("book:plot_design"), snapshot("plot", 7e3));
    await store.save(key("book:character_design"), snapshot("character", 7e3));
    await createConversationPersistenceAdapter(api).prepareHistory("book:chat");
    expect(
      sessions(await new RendererStateStore(root).load(key("book:chat")))
    ).toEqual(["character", "plot"]);
  });
  it("restores all source records after migration failure and retries before saving new input", async () => {
    const { root, store, api } = await fixture();
    await store.save(key("book:plot_design"), snapshot("plot"));
    await store.save(key("book:character_design"), snapshot("character"));
    const migrate = vi
      .fn(api.migrateHistory)
      .mockRejectedValueOnce(new Error("test disk unavailable"));
    const adapter = createConversationPersistenceAdapter({
      ...api,
      migrateHistory: migrate
    });
    await expect(adapter.prepareHistory("book:chat")).rejects.toThrow(
      "test disk unavailable"
    );
    expect(sessions(await adapter.load(key("book:chat")))).toEqual([
      "character",
      "plot"
    ]);
    expect(await store.listHistoryKeys()).toHaveLength(2);
    await adapter.save(key("book:chat"), snapshot("new"));
    await adapter.save(key("book:chat"), snapshot("new", 60));
    expect(
      sessions(await new RendererStateStore(root).load(key("book:chat")))
    ).toEqual(["character", "new", "plot"]);
  });
  it("refuses subsequent writes while migration still fails and retains every original", async () => {
    const { store, api } = await fixture();
    await store.save(key("book:plot_design"), snapshot("plot"));
    const original = await store.load(key("book:plot_design"));
    const adapter = createConversationPersistenceAdapter({
      ...api,
      migrateHistory: async () => {
        throw new Error("test unavailable");
      }
    });
    await expect(adapter.prepareHistory("book:chat")).rejects.toThrow();
    await expect(
      adapter.save(key("book:chat"), snapshot("new"))
    ).rejects.toThrow();
    expect(await store.load(key("book:plot_design"))).toEqual(original);
  });
  it("preserves unread history over repeated saves after an ordinary load failure", async () => {
    const { store, api } = await fixture();
    await store.save(key("book:chat"), snapshot("old"));
    const load = vi
      .fn(api.load)
      .mockRejectedValueOnce(new Error("test read unavailable"));
    const adapter = createConversationPersistenceAdapter({ ...api, load });
    await expect(adapter.load(key("book:chat"))).rejects.toThrow();
    await adapter.save(key("book:chat"), snapshot("new"));
    await adapter.save(key("book:chat"), snapshot("new", 60));
    expect(sessions(await store.load(key("book:chat")))).toEqual([
      "new",
      "old"
    ]);
  });
  it("rolls back source references when the migration backup transaction fails", async () => {
    const { store, api } = await fixture();
    const original = snapshot("plot");
    await store.save(key("book:plot_design"), original);
    const connection = new DatabaseSync(store.statePath);
    try {
      connection.exec(
        "CREATE TRIGGER fail_backup BEFORE INSERT ON legacy_backups BEGIN SELECT RAISE(ABORT, 'test backup unavailable'); END;"
      );
      await expect(
        createConversationPersistenceAdapter(api).prepareHistory("book:chat")
      ).rejects.toThrow("test backup unavailable");
      expect(await store.load(key("book:plot_design"))).toEqual(original);
      expect(await store.load(key("book:chat"))).toBeUndefined();
    } finally {
      connection.close();
    }
  });
  it.each(["source", "target"])(
    "rejects migration if a concurrent %s edit changed the loaded records",
    async (changed) => {
      const { store } = await fixture();
      const sourceKey = key("book:plot_design");
      const targetKey = key("book:chat");
      const source = snapshot("plot");
      const target = snapshot("old");
      await store.save(sourceKey, source);
      await store.save(targetKey, target);
      await store.save(
        changed === "source" ? sourceKey : targetKey,
        snapshot("updated")
      );
      const originals = [
        await store.load(sourceKey),
        await store.load(targetKey)
      ];
      expect(
        await store.migrateHistory({
          key: targetKey,
          value: snapshot("merged"),
          expected: { found: true, value: target },
          sources: [{ key: sourceKey, value: source }]
        })
      ).toBe(false);
      expect([
        await store.load(sourceKey),
        await store.load(targetKey)
      ]).toEqual(originals);
    }
  );
  // Real 68 MiB disk round trips need headroom when the full suite runs in parallel.
  it("keeps writing after merged history exceeds the former 64 MiB item limit", async () => {
    const { store, api } = await fixture();
    await store.save(
      key("book:plot_design"),
      snapshot("plot", 34 * 1024 * 1024)
    );
    await store.save(
      key("book:character_design"),
      snapshot("character", 34 * 1024 * 1024)
    );
    const adapter = createConversationPersistenceAdapter(api);
    await adapter.prepareHistory("book:chat");
    const prior = await adapter.load(key("book:chat"));
    await adapter.save(key("book:chat"), {
      ...prior,
      activeSessionId: "new",
      conversations: [...prior.conversations, ...snapshot("new").conversations]
    });
    const loaded = await store.load(key("book:chat"));
    expect(sessions(loaded)).toEqual(["character", "new", "plot"]);
    expect(
      loaded.conversations
        .filter((record) => record.sessionId !== "new")
        .map((record) => record.messages[0].content.length)
    ).toEqual([34 * 1024 * 1024, 34 * 1024 * 1024]);
  }, 30_000);
  it("keeps unknown records in their source instead of removing unreadable history", async () => {
    const unknown = {
      version: 1,
      activeSessionId: "old",
      conversations: [{ sessionId: "old", legacyContent: "test original" }]
    };
    const { store, api } = await fixture({
      legacyEntries: { [key("book:plot_design")]: unknown }
    });
    await store.save(key("book:character_design"), snapshot("character"));
    await createConversationPersistenceAdapter(api).prepareHistory("book:chat");
    expect(await store.load(key("book:plot_design"))).toEqual(unknown);
    expect(sessions(await store.load(key("book:chat")))).toEqual(["character"]);
  });
  it("keeps an existing target readable when source enumeration temporarily fails", async () => {
    const { store, api } = await fixture();
    await store.save(key("book:chat"), snapshot("old"));
    const adapter = createConversationPersistenceAdapter({
      ...api,
      listHistoryKeys: async () => {
        throw new Error("test unavailable");
      }
    });
    await expect(adapter.prepareHistory("book:chat")).rejects.toThrow();
    expect(sessions(await adapter.load(key("book:chat")))).toEqual(["old"]);
  });
});
