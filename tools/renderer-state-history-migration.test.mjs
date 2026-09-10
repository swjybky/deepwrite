import { RendererStateKeySchema } from "../packages/contracts/src/renderer-state";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererStateStore } from "../apps/desktop/src/utilities/renderer-state-store";
import {
  createConversationPersistenceAdapter,
  conversationHistoryPersistenceKey as key
} from "../apps/desktop/src/renderer/src/utils/conversationPersistence";
const roots = [];
afterEach(async () => {
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
  const store = new RendererStateStore(root, options);
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
    const { store, api } = await fixture();
    const original = {
      version: 1,
      activeSessionId: "old",
      conversations: [{ sessionId: "old", legacyContent: "test original" }]
    };
    await store.save(key("book:chat"), original);
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
    const directory = join(
      dirname(store.statePath),
      "history-migration-backups"
    );
    const backups = await readdir(directory);
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(
      await readFile(join(directory, backups[0]), "utf8")
    );
    expect(backup.entries).toEqual({
      [key("book:plot_design")]: plot,
      [key("book:character_design")]: character
    });
  });
  it("checks the final total instead of double-counting source and merged records", async () => {
    const { root, store, api } = await fixture({
      maxItemBytes: 2e4,
      maxTotalBytes: 2e4
    });
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
    const original = await readFile(store.statePath, "utf8");
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
    expect(await readFile(store.statePath, "utf8")).toBe(original);
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
  it("leaves active originals unchanged if the required backup cannot be written", async () => {
    const { store, api } = await fixture();
    await store.save(key("book:plot_design"), snapshot("plot"));
    const original = await readFile(store.statePath, "utf8");
    await writeFile(
      join(dirname(store.statePath), "history-migration-backups"),
      "test blocked directory"
    );
    await expect(
      createConversationPersistenceAdapter(api).prepareHistory("book:chat")
    ).rejects.toThrow();
    expect(await readFile(store.statePath, "utf8")).toBe(original);
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
      const original = await readFile(store.statePath, "utf8");
      expect(
        await store.migrateHistory({
          key: targetKey,
          value: snapshot("merged"),
          expected: { found: true, value: target },
          sources: [{ key: sourceKey, value: source }]
        })
      ).toBe(false);
      expect(await readFile(store.statePath, "utf8")).toBe(original);
    }
  );
  it("retains sources when the final merged item still exceeds its limit", async () => {
    const { store, api } = await fixture({ maxItemBytes: 2e3 });
    await store.save(key("book:plot_design"), snapshot("plot", 1e3));
    await store.save(key("book:character_design"), snapshot("character", 1e3));
    const original = await readFile(store.statePath, "utf8");
    const adapter = createConversationPersistenceAdapter(api);
    await expect(adapter.prepareHistory("book:chat")).rejects.toThrow(
      "byte limit"
    );
    expect(sessions(await adapter.load(key("book:chat")))).toEqual([
      "character",
      "plot"
    ]);
    expect(await readFile(store.statePath, "utf8")).toBe(original);
  });
  it("keeps unknown records in their source instead of removing unreadable history", async () => {
    const { store, api } = await fixture();
    const unknown = {
      version: 1,
      activeSessionId: "old",
      conversations: [{ sessionId: "old", legacyContent: "test original" }]
    };
    await store.save(key("book:plot_design"), unknown);
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
