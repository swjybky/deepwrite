import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import {
  ModelCallTraceSchema,
  type SystemEventEnvelope
} from "@deepwrite/contracts";

type ActivityEvent = Extract<
  SystemEventEnvelope,
  { type: "subagent.activity" }
>;

/** Diagnostic metadata only; never stores workspace content or credentials.
 * Each line is flushed before returning. A start without an end means unknown
 * outcome, not success. Rotation retains at most three 10 MiB segments.
 */
export function appendSubagentCallJournal(
  directory: string,
  event: ActivityEvent,
  limit = 10 * 1024 * 1024
): void {
  if (event.payload.activity.type !== "model_call") return;
  const { sessionId, runId, parentToolCallId, subagentRunId, subagentId } =
    event.payload;
  const line =
    JSON.stringify({
      schemaVersion: 1,
      sessionId,
      runId,
      parentToolCallId,
      subagentRunId,
      subagentId,
      call: ModelCallTraceSchema.parse(event.payload.activity.call)
    }) + "\n";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "subagent-model-calls.jsonl");
  if (
    existsSync(path) &&
    statSync(path).size + Buffer.byteLength(line) > limit
  ) {
    const oldest = `${path}.2`;
    if (existsSync(oldest)) unlinkSync(oldest);
    if (existsSync(`${path}.1`)) renameSync(`${path}.1`, oldest);
    renameSync(path, `${path}.1`);
  }
  const fd = openSync(path, "a", 0o600);
  try {
    writeFileSync(fd, line, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
