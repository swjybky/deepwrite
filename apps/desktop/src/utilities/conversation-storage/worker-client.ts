import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import { recordStorageFailure } from "./storage-diagnostics";
import {
  describeStorageFailure,
  storageFailureError,
  type StorageFailure
} from "./storage-failure";
import type {
  ConversationHistoryApi,
  ConversationHistoryArchiveListQuery,
  ConversationHistoryArchiveListResult,
  ConversationHistoryPurgeQuery,
  ConversationHistoryPurgeResult,
  ConversationHistoryMergeScopesQuery,
  ConversationHistoryMergeScopesResult,
  ConversationHistoryBatch,
  ConversationHistoryCommitResult,
  ConversationHistoryDetailQuery,
  ConversationHistoryMetadataDetailQuery,
  ConversationHistoryDetailResult,
  ConversationHistoryListQuery,
  ConversationHistoryListResult,
  ConversationHistoryMessagesQuery,
  ConversationHistoryMessagesResult,
  ConversationHistorySessionQuery,
  ConversationHistorySession,
  ConversationHistoryTurnsQuery,
  ConversationHistoryTurnsResult,
  ConversationHistoryStage,
  ConversationHistoryStageResult,
  RendererStateHistoryMigration
} from "@deepwrite/contracts";

type Pending = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export class ConversationStorageWorker implements ConversationHistoryApi {
  private worker: Worker | undefined;
  private starting: Promise<Worker> | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly databasePath: string,
    private readonly workerPath: string,
    private readonly legacyStatePath?: string
  ) {}

  private async start(): Promise<Worker> {
    if (this.starting) return this.starting;
    if (this.worker) return this.worker;
    this.starting = mkdir(dirname(this.databasePath), { recursive: true })
      .then(
        () =>
          new Promise<Worker>((resolve, reject) => {
            const worker = new Worker(this.workerPath, {
              workerData: {
                databasePath: this.databasePath,
                legacyStatePath: this.legacyStatePath
              }
            });
            this.worker = worker;
            let ready = false;
            const fail = (error: Error, expected = false) => {
              if (this.worker !== worker) return;
              this.worker = undefined;
              const failure = describeStorageFailure(error, "worker-start");
              const reported = storageFailureError(failure);
              if (ready && !expected)
                recordStorageFailure(this.databasePath, failure);
              reject(reported);
              for (const pending of this.pending.values())
                pending.reject(reported);
              this.pending.clear();
            };
            worker.on(
              "message",
              (
                response:
                  | { kind: "ready" }
                  | { kind: "startup.failed"; error: StorageFailure }
                  | { id: number; result?: unknown; error?: StorageFailure }
              ) => {
                if ("kind" in response) {
                  if (response.kind === "startup.failed")
                    fail(storageFailureError(response.error));
                  else {
                    ready = true;
                    resolve(worker);
                  }
                  return;
                }
                const pending = this.pending.get(response.id);
                if (!pending) return;
                this.pending.delete(response.id);
                if (response.error) {
                  recordStorageFailure(
                    this.databasePath,
                    response.error,
                    pending.method
                  );
                  pending.reject(storageFailureError(response.error));
                } else pending.resolve(response.result);
              }
            );
            worker.on("error", fail);
            worker.on("exit", (code) =>
              fail(
                new Error(
                  `Conversation storage worker exited (${code}); retry the unconfirmed batch.`
                ),
                code === 0 && (this.closed || Boolean(this.closing))
              )
            );
          })
      )
      .catch((error: unknown) => {
        const failure = describeStorageFailure(error, "worker-start");
        recordStorageFailure(this.databasePath, failure);
        throw storageFailureError(failure);
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }

  private async request<T>(method: string, payload?: unknown): Promise<T> {
    if (this.closed || (this.closing && method !== "close"))
      throw new Error("Conversation storage is closed.");
    const worker = await this.start();
    if (this.pending.size >= 32 && method !== "close")
      throw Object.assign(
        new Error(
          "Conversation storage is busy; retain and retry the pending data."
        ),
        { code: "queue_full" }
      );
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: (result) => resolve(result as T),
        reject
      });
      try {
        worker.postMessage({ id, method, payload });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  commit(
    payload: ConversationHistoryBatch
  ): Promise<ConversationHistoryCommitResult> {
    return this.request("commit", payload);
  }
  mergeScopes(
    payload: ConversationHistoryMergeScopesQuery
  ): Promise<ConversationHistoryMergeScopesResult> {
    return this.request("mergeScopes", payload);
  }
  metadataDetail(
    payload: ConversationHistoryMetadataDetailQuery
  ): Promise<ConversationHistoryDetailResult> {
    return this.request("metadataDetail", payload);
  }
  stage(
    payload: ConversationHistoryStage
  ): Promise<ConversationHistoryStageResult> {
    return this.request("stage", payload);
  }
  list(
    payload: ConversationHistoryListQuery
  ): Promise<ConversationHistoryListResult> {
    return this.request("list", payload);
  }
  listArchived(
    payload: ConversationHistoryArchiveListQuery
  ): Promise<ConversationHistoryArchiveListResult> {
    return this.request("listArchived", payload);
  }
  purge(
    payload: ConversationHistoryPurgeQuery
  ): Promise<ConversationHistoryPurgeResult> {
    return this.request("purge", payload);
  }
  session(
    payload: ConversationHistorySessionQuery
  ): Promise<ConversationHistorySession | null> {
    return this.request("session", payload);
  }
  messages(
    payload: ConversationHistoryMessagesQuery
  ): Promise<ConversationHistoryMessagesResult> {
    return this.request("messages", payload);
  }
  detail(
    payload: ConversationHistoryDetailQuery
  ): Promise<ConversationHistoryDetailResult> {
    return this.request("detail", payload);
  }
  turns(
    payload: ConversationHistoryTurnsQuery
  ): Promise<ConversationHistoryTurnsResult> {
    return this.request("turns", payload);
  }

  legacyLoad(key: string): Promise<unknown | undefined> {
    return this.request("legacyLoad", key);
  }
  legacySave(key: string, value: unknown): Promise<void> {
    return this.request("legacySave", { key, value });
  }
  legacyRemove(key: string): Promise<void> {
    return this.request("legacyRemove", key);
  }
  legacyListHistoryKeys(): Promise<string[]> {
    return this.request("legacyListHistoryKeys");
  }
  legacyMigrateHistory(
    payload: RendererStateHistoryMigration
  ): Promise<boolean> {
    return this.request("legacyMigrateHistory", payload);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (this.worker || this.starting) await this.request("close");
      this.closed = true;
    })();
    try {
      await this.closing;
    } finally {
      this.closing = undefined;
    }
  }
}
