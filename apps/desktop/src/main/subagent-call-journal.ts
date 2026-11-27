import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ModelCallTraceSchema,
  type SystemEventEnvelope
} from "@deepwrite/contracts";

type ActivityEvent = Extract<
  SystemEventEnvelope,
  { type: "subagent.activity" }
>;

type CallStatus = Extract<
  ActivityEvent["payload"]["activity"],
  { type: "model_call" }
>["call"]["status"];

interface QueuedJournalEntry {
  directory: string;
  line: string;
  byteLength: number;
  limit: number;
  status: CallStatus;
}

export interface SubagentCallJournalOptions {
  maxQueueEntries?: number;
  maxQueueBytes?: number;
  onError?: (error: unknown) => void;
}

export interface SubagentCallJournalStats {
  queuedEntries: number;
  queuedBytes: number;
  writtenEntries: number;
  droppedEntries: number;
  droppedRunningEntries: number;
}

export interface SubagentCallJournal {
  enqueue(directory: string, event: ActivityEvent, limit?: number): boolean;
  flush(): Promise<void>;
  close(): Promise<void>;
  stats(): SubagentCallJournalStats;
}

const DEFAULT_SEGMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_QUEUE_ENTRIES = 512;
const DEFAULT_MAX_QUEUE_BYTES = 4 * 1024 * 1024;
const WINDOWS_TRANSIENT_CODES = new Set(["EPERM", "EBUSY"]);

function isTransientFileLockError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && WINDOWS_TRANSIENT_CODES.has(code);
}

async function retryTransientFileOp<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts || !isTransientFileLockError(error)) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 15 * attempt));
    }
  }
}

async function fileSizeIfExists(filePath: string): Promise<number> {
  try {
    const info = await stat(filePath);
    return info.size;
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return 0;
    throw error;
  }
}

async function rotateSegments(filePath: string): Promise<void> {
  const oldest = `${filePath}.2`;
  const firstBackup = `${filePath}.1`;
  await retryTransientFileOp(() => rm(oldest, { force: true }));
  if (
    (await fileSizeIfExists(firstBackup)) > 0 ||
    (await existsAsync(firstBackup))
  ) {
    await retryTransientFileOp(() => rename(firstBackup, oldest));
  }
  if (await existsAsync(filePath)) {
    await retryTransientFileOp(() => rename(filePath, firstBackup));
  }
}

async function existsAsync(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Bounded async diagnostic journal for subagent `model_call` metadata.
 * Offloads all disk writes from Main's synchronous IPC path, bounds memory under
 * bursts while prioritizing terminal records over `"running"` records, and keeps
 * rotation semantics (`limit`, `.1`, `.2`) with async Windows lock retries.
 */
export function createSubagentCallJournal(
  options: SubagentCallJournalOptions = {}
): SubagentCallJournal {
  const maxQueueEntries = options.maxQueueEntries ?? DEFAULT_MAX_QUEUE_ENTRIES;
  const maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error("DeepWrite model call journal write failed:", error);
    });

  const queue: QueuedJournalEntry[] = [];
  const ensuredDirectories = new Set<string>();
  const flushWaiters: (() => void)[] = [];
  let queuedBytes = 0;
  let writtenEntries = 0;
  let droppedEntries = 0;
  let droppedRunningEntries = 0;
  let scheduled = false;
  let pumping = false;
  let closed = false;

  const notifyIdleIfDone = (): void => {
    if (scheduled || pumping || queue.length > 0) return;
    while (flushWaiters.length > 0) {
      flushWaiters.shift()?.();
    }
  };

  const schedulePump = (): void => {
    if (scheduled || pumping || queue.length === 0) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void pump();
    });
  };

  const evictOneForCapacity = (): void => {
    const runningIndex = queue.findIndex((item) => item.status === "running");
    const dropIndex = runningIndex >= 0 ? runningIndex : 0;
    const [dropped] = queue.splice(dropIndex, 1);
    if (!dropped) return;
    queuedBytes -= dropped.byteLength;
    droppedEntries += 1;
    if (dropped.status === "running") {
      droppedRunningEntries += 1;
    }
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const first = queue.shift()!;
        queuedBytes -= first.byteLength;
        const batch = [first];
        let batchBytes = first.byteLength;

        if (!ensuredDirectories.has(first.directory)) {
          await mkdir(first.directory, { recursive: true, mode: 0o700 });
          ensuredDirectories.add(first.directory);
        }

        const filePath = join(first.directory, "subagent-model-calls.jsonl");
        let currentSize = await fileSizeIfExists(filePath);
        if (currentSize > 0 && currentSize + batchBytes > first.limit) {
          await rotateSegments(filePath);
          currentSize = 0;
        }

        // Coalesce subsequent entries in the same directory that fit without rotating.
        while (
          queue.length > 0 &&
          queue[0]!.directory === first.directory &&
          queue[0]!.limit === first.limit &&
          currentSize + batchBytes + queue[0]!.byteLength <= first.limit
        ) {
          const next = queue.shift()!;
          queuedBytes -= next.byteLength;
          batch.push(next);
          batchBytes += next.byteLength;
        }

        const payload = batch.map((entry) => entry.line).join("");
        await retryTransientFileOp(() =>
          appendFile(filePath, payload, { encoding: "utf8", mode: 0o600 })
        );
        writtenEntries += batch.length;
      }
    } catch (error) {
      onError(error);
    } finally {
      pumping = false;
      if (queue.length > 0) {
        void pump();
      } else {
        notifyIdleIfDone();
      }
    }
  };

  const enqueue = (
    directory: string,
    event: ActivityEvent,
    limit = DEFAULT_SEGMENT_LIMIT_BYTES
  ): boolean => {
    if (closed) return false;
    if (event.payload.activity.type !== "model_call") return false;
    const { sessionId, runId, parentToolCallId, subagentRunId, subagentId } =
      event.payload;
    const call = ModelCallTraceSchema.parse(event.payload.activity.call);
    const line =
      JSON.stringify({
        schemaVersion: 1,
        sessionId,
        runId,
        parentToolCallId,
        subagentRunId,
        subagentId,
        call
      }) + "\n";
    const byteLength = Buffer.byteLength(line, "utf8");

    while (
      queue.length > 0 &&
      (queue.length >= maxQueueEntries ||
        queuedBytes + byteLength > maxQueueBytes)
    ) {
      evictOneForCapacity();
    }

    queue.push({
      directory,
      line,
      byteLength,
      limit,
      status: call.status
    });
    queuedBytes += byteLength;
    schedulePump();
    return true;
  };

  const flush = (): Promise<void> => {
    if (!scheduled && !pumping && queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      flushWaiters.push(resolve);
      schedulePump();
    });
  };

  const close = async (): Promise<void> => {
    closed = true;
    await flush();
  };

  const stats = (): SubagentCallJournalStats => ({
    queuedEntries: queue.length,
    queuedBytes,
    writtenEntries,
    droppedEntries,
    droppedRunningEntries
  });

  return { enqueue, flush, close, stats };
}

const sharedJournal = createSubagentCallJournal();

/** Local model input/metadata diagnostic journal; async and bounded. */
export async function appendSubagentCallJournal(
  directory: string,
  event: ActivityEvent,
  limit = DEFAULT_SEGMENT_LIMIT_BYTES
): Promise<void> {
  sharedJournal.enqueue(directory, event, limit);
  await sharedJournal.flush();
}
