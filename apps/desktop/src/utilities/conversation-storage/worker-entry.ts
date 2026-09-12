import { parentPort, workerData } from "node:worker_threads";
import {
  ConversationHistoryBatchSchema,
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
  RendererStateHistoryMigrationSchema
} from "@deepwrite/contracts";
import { ConversationDatabase, ConversationStorageError } from "./database";
import { LegacyConversationStore } from "./legacy-store";
import { migrateLegacyFile } from "./legacy-file-migration";

if (!parentPort)
  throw new Error("Conversation storage must run in a Core-owned worker.");
const port = parentPort;
const paths = workerData as { databasePath: string; legacyStatePath?: string };
const database = new ConversationDatabase(paths.databasePath);
if (paths.legacyStatePath)
  await migrateLegacyFile(database.database, paths.legacyStatePath);
if (process.env.DEEPWRITE_MAIN_INSTANCE_ID)
  database.claimMainInstance(process.env.DEEPWRITE_MAIN_INSTANCE_ID);
const legacy = new LegacyConversationStore(database.database, () =>
  database.assertMainInstance()
);

port.on(
  "message",
  (request: { id: number; method: string; payload?: unknown }) => {
    try {
      let result: unknown;
      switch (request.method) {
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
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Conversation storage failed.",
          code:
            error instanceof ConversationStorageError
              ? error.code
              : "storage_failed"
        }
      });
    }
  }
);

// Maintenance runs only between requests and never removes referenced user content.
const collection = setInterval(() => {
  try {
    database.collectUnreferencedChunks(128);
  } catch {
    /* A later write reports actionable storage errors. */
  }
}, 1000);
collection.unref();
const checkpoint = setInterval(() => {
  try {
    database.checkpoint();
  } catch {
    /* Retry the next bounded maintenance pass. */
  }
}, 30_000);
checkpoint.unref();
