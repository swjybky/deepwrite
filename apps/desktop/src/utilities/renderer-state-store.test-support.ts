import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ConversationDatabase } from "./conversation-storage/database";
import { LegacyConversationStore } from "./conversation-storage/legacy-store";
import { migrateLegacyFile } from "./conversation-storage/legacy-file-migration";
import {
  RendererStateStore,
  type RendererStateBackend
} from "./renderer-state-store";

const backends = new Set<RendererStateBackend>();

function inProcessBackend(root: string): RendererStateBackend {
  let loaded:
    | Promise<{
        database: ConversationDatabase;
        legacy: LegacyConversationStore;
      }>
    | undefined;
  const path = join(root, "renderer-state", "conversations.sqlite");
  async function runtime() {
    loaded ??= mkdir(dirname(path), { recursive: true }).then(async () => {
      const database = new ConversationDatabase(path);
      try {
        await migrateLegacyFile(
          database.database,
          join(root, "renderer-state", "conversation-persistence.json")
        );
      } catch (error) {
        database.close();
        throw error;
      }
      return {
        database,
        legacy: new LegacyConversationStore(database.database)
      };
    });
    return loaded;
  }
  return {
    mergeScopes: async (value) => (await runtime()).database.mergeScopes(value),
    stage: async (value) => (await runtime()).database.stage(value),
    commit: async (value) => (await runtime()).database.commit(value),
    list: async (value) => (await runtime()).database.list(value),
    session: async (value) => (await runtime()).database.session(value),
    messages: async (value) => (await runtime()).database.messages(value),
    detail: async (value) => (await runtime()).database.detail(value),
    metadataDetail: async (value) =>
      (await runtime()).database.metadataDetail(value),
    turns: async (value) => (await runtime()).database.turns(value),
    legacyLoad: async (key) => (await runtime()).legacy.load(key),
    legacySave: async (key, value) => {
      (await runtime()).legacy.save(key, value);
    },
    legacyRemove: async (key) => {
      (await runtime()).legacy.remove(key);
    },
    legacyListHistoryKeys: async () =>
      (await runtime()).legacy.listHistoryKeys(),
    legacyMigrateHistory: async (value) =>
      (await runtime()).legacy.migrateHistory(value),
    async close() {
      const current = await loaded?.catch(() => undefined);
      current?.database.close();
      loaded = undefined;
    }
  };
}

/** Disk-backed facade tests, with worker transport covered separately in Electron. */
export class TestRendererStateStore extends RendererStateStore {
  constructor(root: string) {
    const backend = inProcessBackend(root);
    backends.add(backend);
    super(root, { backend });
  }
}

export async function closeRendererStateTestStores(): Promise<void> {
  await Promise.all([...backends].map((backend) => backend.close()));
  backends.clear();
}
