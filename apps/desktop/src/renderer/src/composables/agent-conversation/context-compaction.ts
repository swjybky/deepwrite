import { t } from "../../i18n";
import { reactive } from "vue";
import type {
  AgentContextCompactionPayload,
  ContextCompactionRequest,
  ConversationCheckpoint
} from "@deepwrite/contracts";
import { ConversationCheckpointSchema } from "@deepwrite/contracts/renderer";
import type {
  ChatContextCompaction,
  ChatMessage
} from "../../types/conversation";
import { validDate } from "./shared";
import { isRecord } from "@deepwrite/shared";

const MAX_COMPACTIONS_PER_MESSAGE = 8;
const REASONS = new Set([
  "threshold",
  "overflow",
  "manual",
  "run_limit",
  "idle"
]);
const LEVELS = new Set(["prune", "summary"]);
const STATUSES = new Set(["running", "completed", "failed"]);

function boundedCompactions(
  items: ChatContextCompaction[]
): ChatContextCompaction[] {
  const tail = items.slice(-MAX_COMPACTIONS_PER_MESSAGE);
  const latest = [...items]
    .reverse()
    .find((item) => item.status === "completed" && item.checkpoint);
  if (latest && !tail.includes(latest)) return [latest, ...tail.slice(1)];
  return tail;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

export function parseStoredContextCompactions(
  value: unknown
): ChatContextCompaction[] {
  if (!Array.isArray(value)) return [];
  return boundedCompactions(
    value.flatMap((item) => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        !STATUSES.has(String(item.status)) ||
        !REASONS.has(String(item.reason)) ||
        !validDate(item.createdAt)
      ) {
        return [];
      }
      const checkpoint = ConversationCheckpointSchema.safeParse(
        item.checkpoint
      );
      const tokensBefore = optionalCount(item.tokensBefore);
      const tokensAfter = optionalCount(item.tokensAfter);
      const level = LEVELS.has(String(item.level))
        ? (item.level as NonNullable<ChatContextCompaction["level"]>)
        : undefined;
      const parsed: ChatContextCompaction = {
        id: item.id,
        // A run that was interrupted mid-compaction never finished it.
        status:
          item.status === "running"
            ? "failed"
            : (item.status as ChatContextCompaction["status"]),
        reason: item.reason as ChatContextCompaction["reason"],
        createdAt: item.createdAt,
        ...(validDate(item.completedAt)
          ? { completedAt: item.completedAt }
          : {}),
        ...(level ? { level } : {}),
        ...(tokensBefore !== undefined ? { tokensBefore } : {}),
        ...(tokensAfter !== undefined ? { tokensAfter } : {}),
        ...(checkpoint.success ? { checkpoint: checkpoint.data } : {}),
        ...(typeof item.errorMessage === "string"
          ? { errorMessage: item.errorMessage }
          : item.status === "running"
            ? {
                errorMessage: t(
                  "workspace.contextCompaction.compactionWasNotCompletedTheRunWasInterrupted"
                )
              }
            : {})
      };
      return [parsed];
    })
  );
}

/** Folds one `agent.context_compaction` event into the run's message. */
export function applyContextCompactionEvent(
  message: ChatMessage,
  payload: AgentContextCompactionPayload,
  eventId: string,
  timestamp: string
): void {
  const items = [...(message.contextCompactions ?? [])];
  let running = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.status === "running" && item.reason === payload.reason) {
      running = index;
      break;
    }
  }
  const next: ChatContextCompaction = {
    id: running >= 0 ? items[running]!.id : eventId,
    status: payload.phase === "started" ? "running" : payload.phase,
    reason: payload.reason,
    createdAt: running >= 0 ? items[running]!.createdAt : timestamp,
    ...(payload.phase !== "started" ? { completedAt: timestamp } : {}),
    ...(payload.level ? { level: payload.level } : {}),
    ...(payload.tokensBefore !== undefined
      ? { tokensBefore: payload.tokensBefore }
      : {}),
    ...(payload.tokensAfter !== undefined
      ? { tokensAfter: payload.tokensAfter }
      : {}),
    ...(payload.checkpoint ? { checkpoint: payload.checkpoint } : {}),
    ...(payload.errorMessage ? { errorMessage: payload.errorMessage } : {})
  };
  if (running >= 0 && payload.phase !== "started") items[running] = next;
  else {
    items.push(next);
    (message.processingSteps ??= []).push({
      id: `compaction:${next.id}`,
      type: "compaction",
      compactionId: next.id,
      createdAt: timestamp
    });
  }
  message.contextCompactions = boundedCompactions(items);
}

export interface ConversationCheckpointLocation {
  checkpoint: ConversationCheckpoint;
  /** Messages from here on are kept verbatim after the checkpoint. */
  keepFrom: number;
}

function precedingUserIndex(
  messages: readonly ChatMessage[],
  index: number
): number {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "user") return cursor;
  }
  return Math.max(0, index);
}

/**
 * The newest checkpoint in `messages` and the first message it did not
 * summarize: the run named `firstKeptRunId`, else the compacting run itself.
 */
export function latestConversationCheckpoint(
  messages: readonly ChatMessage[]
): ConversationCheckpointLocation | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    const checkpoint = [...(message.contextCompactions ?? [])]
      .reverse()
      .find(
        (item) => item.status === "completed" && item.checkpoint
      )?.checkpoint;
    if (!checkpoint) continue;
    const keptRun = checkpoint.firstKeptRunId
      ? messages.findIndex(
          (candidate) =>
            candidate.role === "assistant" &&
            candidate.runId === checkpoint.firstKeptRunId
        )
      : -1;
    if (keptRun >= 0 && keptRun <= index) {
      return {
        checkpoint,
        keepFrom: precedingUserIndex(messages, keptRun - 1)
      };
    }
    const timestamp = checkpoint.firstKeptCreatedAt;
    const keptMessage = timestamp
      ? messages.findIndex((item) => item.createdAt === timestamp)
      : -1;
    // Unknown legacy boundaries must not silently drop unsummarized decisions.
    return {
      checkpoint,
      keepFrom: keptMessage >= 0 ? precedingUserIndex(messages, keptMessage) : 0
    };
  }
  return undefined;
}

const pendingRequests = reactive(new Map<string, ContextCompactionRequest>());

/** Manual compaction is applied before the next reply in that conversation. */
export function requestContextCompaction(
  sessionId: string,
  instructions?: string
): void {
  const trimmed = instructions?.trim();
  pendingRequests.set(sessionId, trimmed ? { instructions: trimmed } : {});
}

export function cancelContextCompaction(sessionId: string): void {
  pendingRequests.delete(sessionId);
}

export function pendingContextCompaction(
  sessionId: string
): ContextCompactionRequest | undefined {
  return pendingRequests.get(sessionId);
}
