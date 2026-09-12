import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RendererStateKeySchema,
  RendererStateHistoryMigrationSchema,
  type ConversationHistoryApi,
  type RendererStateHistoryMigration
} from "@deepwrite/contracts";
import { ConversationStorageWorker } from "./conversation-storage/worker-client";
import { rendererStateJson } from "./renderer-state-json";
export { RendererStateSerializationError } from "./renderer-state-json";

export interface RendererStateBackend extends ConversationHistoryApi {
  legacyLoad(key: string): Promise<unknown | undefined>;
  legacySave(key: string, value: unknown): Promise<void>;
  legacyRemove(key: string): Promise<void>;
  legacyListHistoryKeys(): Promise<string[]>;
  legacyMigrateHistory(value: RendererStateHistoryMigration): Promise<boolean>;
  close(): Promise<void>;
}

export interface RendererStateStoreOptions {
  workerPath?: string;
  /** Injection keeps unit tests in process; production always uses the Core-owned worker. */
  backend?: RendererStateBackend;
}

/** Core owns this facade. The worker is the sole writer and migrates the old file before serving reads. */
export class RendererStateStore {
  readonly statePath: string;
  readonly legacyStatePath: string;
  readonly history: ConversationHistoryApi;
  private readonly backend: RendererStateBackend;

  constructor(userDataPath: string, options: RendererStateStoreOptions = {}) {
    if (!userDataPath.trim())
      throw new Error(
        "Renderer state store requires an application data path."
      );
    this.statePath = join(
      userDataPath,
      "renderer-state",
      "conversations.sqlite"
    );
    this.legacyStatePath = join(
      userDataPath,
      "renderer-state",
      "conversation-persistence.json"
    );
    this.backend =
      options.backend ??
      new ConversationStorageWorker(
        this.statePath,
        options.workerPath ??
          fileURLToPath(
            new URL("./conversation-storage/worker-entry.js", import.meta.url)
          ),
        this.legacyStatePath
      );
    this.history = this.backend;
  }

  listHistoryKeys(): Promise<string[]> {
    return this.backend.legacyListHistoryKeys();
  }
  load(key: string): Promise<unknown | undefined> {
    return this.backend.legacyLoad(RendererStateKeySchema.parse(key));
  }
  async save(key: string, value: unknown): Promise<void> {
    await this.backend.legacySave(
      RendererStateKeySchema.parse(key),
      rendererStateJson(value)
    );
  }
  remove(key: string): Promise<void> {
    return this.backend.legacyRemove(RendererStateKeySchema.parse(key));
  }
  migrateHistory(value: RendererStateHistoryMigration): Promise<boolean> {
    return this.backend.legacyMigrateHistory(
      RendererStateHistoryMigrationSchema.parse(value)
    );
  }
  close(): Promise<void> {
    return this.backend.close();
  }
}
