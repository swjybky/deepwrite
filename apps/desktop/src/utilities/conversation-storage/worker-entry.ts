import { parentPort, workerData } from "node:worker_threads";
import {
  ConversationHistoryBatchSchema,
  ConversationHistoryArchiveListQuerySchema,
  ConversationHistoryPurgeQuerySchema,
  ConversationHistoryMergeScopesQuerySchema,
  ConversationHistoryDetailQuerySchema,
  ConversationHistoryMetadataDetailQuerySchema,
  ConversationHistoryListQuerySchema,
  ConversationHistoryMessagesQuerySchema,
  ConversationHistorySessionQuerySchema,
  ConversationHistoryTurnsQuerySchema,
  ConversationHistoryStageSchema,
  RendererStateKeySchema,
  RendererStateSaveCommandEnvelopeSchema,
  RendererStateHistoryMigrationSchema,
  type ConversationCompactionStatus
} from "@deepwrite/contracts";
import { ConversationDatabase, ConversationStorageError } from "./database";
import { LegacyConversationStore } from "./legacy-store";
import {
  inspectCompactionStatus,
  releaseCompactionBackup,
  runConversationCompaction,
  type CompactionDatabaseHandle
} from "./legacy-snapshot-compaction";
import { initializeConversationStorage } from "./worker-startup";
import { describeStorageFailure } from "./storage-failure";

if (!parentPort)
  throw new Error("Conversation storage must run in a Core-owned worker.");
const port = parentPort;
const paths = workerData as { databasePath: string; legacyStatePath?: string };
const mainInstanceId = process.env.DEEPWRITE_MAIN_INSTANCE_ID;
let database = await initializeConversationStorage(
  paths,
  mainInstanceId,
  (error) => port.postMessage({ kind: "startup.failed", error })
);
let legacy = new LegacyConversationStore(database.database, () =>
  database.assertMainInstance()
);
let writeBlockedReason: string | undefined;
let swapGate: Promise<void> | undefined;
let releaseSwapGate: (() => void) | undefined;
let activeCompaction: Promise<ConversationCompactionStatus> | undefined;
let abortActiveCompaction = false;

const WRITE_METHODS = new Set([
  "commit",
  "stage",
  "mergeScopes",
  "purge",
  "legacySave",
  "legacyRemove",
  "legacyMigrateHistory"
]);

const PREEMPT_COMPACTION_METHODS = new Set([
  "commit",
  "stage",
  "mergeScopes",
  "purge",
  "legacyMigrateHistory"
]);

const compactionHandle: CompactionDatabaseHandle = {
  getDatabase: () => database,
  closeDatabase: () => {
    if (!swapGate) {
      swapGate = new Promise<void>((resolve) => {
        releaseSwapGate = resolve;
      });
    }
    database.close();
  },
  reopenDatabase: () => {
    const reopened = new ConversationDatabase(paths.databasePath);
    if (mainInstanceId) reopened.claimMainInstance(mainInstanceId);
    database = reopened;
    legacy = new LegacyConversationStore(database.database, () =>
      database.assertMainInstance()
    );
    releaseSwapGate?.();
    releaseSwapGate = undefined;
    swapGate = undefined;
    return reopened;
  },
  setWriteBlocked: (reason) => {
    writeBlockedReason = reason;
  },
  onProgress: (status) => {
    port.postMessage({ kind: "compaction.updated", status });
  }
};

port.on(
  "message",
  async (request: { id: number; method: string; payload?: unknown }) => {
    try {
      if (activeCompaction && WRITE_METHODS.has(request.method)) {
        if (!swapGate && PREEMPT_COMPACTION_METHODS.has(request.method)) {
          abortActiveCompaction = true;
        }
        await activeCompaction.catch(() => undefined);
      }
      if (swapGate && request.method !== "close") {
        await swapGate;
      }
      if (writeBlockedReason && WRITE_METHODS.has(request.method)) {
        throw new ConversationStorageError(
          "database_locked",
          writeBlockedReason
        );
      }
      let result: unknown;
      switch (request.method) {
        case "compactionStatus":
          result = await inspectCompactionStatus(database);
          break;
        case "compactConversations": {
          const payload =
            (request.payload as { force?: boolean } | undefined) ?? {};
          if (!activeCompaction) {
            abortActiveCompaction = false;
            activeCompaction = runConversationCompaction(compactionHandle, {
              ...payload,
              shouldAbort: () => abortActiveCompaction
            }).finally(() => {
              abortActiveCompaction = false;
              activeCompaction = undefined;
            });
          }
          result = await activeCompaction;
          break;
        }
        case "releaseCompactionBackup":
          if (activeCompaction) await activeCompaction;
          result = await releaseCompactionBackup(compactionHandle);
          break;
        case "mergeScopes":
          result = database.mergeScopes(
            ConversationHistoryMergeScopesQuerySchema.parse(request.payload)
          );
          break;
        case "metadataDetail":
          result = database.metadataDetail(
            ConversationHistoryMetadataDetailQuerySchema.parse(request.payload)
          );
          break;
        case "legacyLoad":
          result = legacy.load(RendererStateKeySchema.parse(request.payload));
          break;
        case "legacySave": {
          const payload =
            RendererStateSaveCommandEnvelopeSchema.shape.payload.parse(
              request.payload
            );
          legacy.save(payload.key, payload.value);
          result = null;
          break;
        }
        case "legacyRemove":
          legacy.remove(RendererStateKeySchema.parse(request.payload));
          result = null;
          break;
        case "legacyListHistoryKeys":
          result = legacy.listHistoryKeys();
          break;
        case "legacyMigrateHistory":
          result = legacy.migrateHistory(
            RendererStateHistoryMigrationSchema.parse(request.payload)
          );
          break;
        case "stage":
          result = database.stage(
            ConversationHistoryStageSchema.parse(request.payload)
          );
          break;
        case "commit":
          result = database.commit(
            ConversationHistoryBatchSchema.parse(request.payload)
          );
          break;
        case "list":
          result = database.list(
            ConversationHistoryListQuerySchema.parse(request.payload)
          );
          break;
        case "listArchived":
          result = database.listArchived(
            ConversationHistoryArchiveListQuerySchema.parse(request.payload)
          );
          break;
        case "purge":
          result = database.purge(
            ConversationHistoryPurgeQuerySchema.parse(request.payload)
          );
          break;
        case "session":
          result = database.session(
            ConversationHistorySessionQuerySchema.parse(request.payload)
          );
          break;
        case "messages":
          result = database.messages(
            ConversationHistoryMessagesQuerySchema.parse(request.payload)
          );
          break;
        case "detail":
          result = database.detail(
            ConversationHistoryDetailQuerySchema.parse(request.payload)
          );
          break;
        case "turns":
          result = database.turns(
            ConversationHistoryTurnsQuerySchema.parse(request.payload)
          );
          break;
        case "close":
          if (activeCompaction) {
            await activeCompaction.catch(() => undefined);
          }
          database.close();
          port.postMessage({ id: request.id, result: null });
          port.close();
          return;
        default:
          throw new Error("Unsupported conversation storage request.");
      }
      port.postMessage({ id: request.id, result });
    } catch (error) {
      port.postMessage({
        id: request.id,
        error: describeStorageFailure(error, "operation")
      });
    }
  }
);
port.postMessage({ kind: "ready" });

// Maintenance runs only between requests and never removes referenced user content.
const collection = setInterval(() => {
  if (swapGate || writeBlockedReason) return;
  try {
    database.collectUnreferencedChunks(128);
  } catch {
    /* A later write reports actionable storage errors. */
  }
}, 1000);
collection.unref();
const checkpoint = setInterval(() => {
  if (swapGate || writeBlockedReason) return;
  try {
    database.checkpoint();
  } catch {
    /* Retry the next bounded maintenance pass. */
  }
}, 30_000);
checkpoint.unref();
