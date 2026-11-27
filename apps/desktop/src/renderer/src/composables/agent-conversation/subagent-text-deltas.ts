import type { AgentSubagentRun } from "../../types/conversation";
import type { AgentConversationContext } from "./context";
import type { TrackedMessages } from "./message-mutations";
import type { PendingSubagentTextDelta } from "./types";

type SubagentTextDeltaContext = Pick<
  AgentConversationContext,
  "pendingSubagentTextDeltas"
> & { messageMutations: Pick<TrackedMessages, "appendText"> };

function applySubagentTextDelta(
  ctx: SubagentTextDeltaContext,
  pending: PendingSubagentTextDelta
): void {
  const { run } = pending;
  const delta = pending.chunks.join("");
  const stepType = pending.type === "thinking_delta" ? "thinking" : "response";
  if (pending.type === "thinking_delta") {
    ctx.messageMutations.appendText(run, "thinking", delta);
  } else {
    ctx.messageMutations.appendText(run, "output", delta);
  }
  const lastStep = run.processingSteps.at(-1);
  if (lastStep?.type === stepType) {
    ctx.messageMutations.appendText(lastStep, "content", delta);
  } else {
    run.processingSteps.push({
      id: pending.eventId,
      type: stepType,
      content: delta,
      createdAt: pending.createdAt
    });
  }
}

/**
 * Holds a child's text until the next frame, like the parent's own stream.
 * Parallel children otherwise re-render the conversation once per fragment
 * each. A switch between thinking and handoff text settles the earlier part.
 */
export function queueSubagentTextDelta(
  ctx: SubagentTextDeltaContext,
  key: string,
  run: AgentSubagentRun,
  delta: Omit<PendingSubagentTextDelta, "run" | "chunks"> & { text: string }
): void {
  const pending = ctx.pendingSubagentTextDeltas.get(key);
  if (pending?.run === run && pending.type === delta.type) {
    pending.chunks.push(delta.text);
    return;
  }
  if (pending) {
    ctx.pendingSubagentTextDeltas.delete(key);
    applySubagentTextDelta(ctx, pending);
  }
  ctx.pendingSubagentTextDeltas.set(key, {
    run,
    type: delta.type,
    eventId: delta.eventId,
    createdAt: delta.createdAt,
    chunks: [delta.text]
  });
}

export function flushPendingSubagentTextDeltas(
  ctx: SubagentTextDeltaContext
): void {
  if (!ctx.pendingSubagentTextDeltas.size) return;
  const pending = [...ctx.pendingSubagentTextDeltas.values()];
  ctx.pendingSubagentTextDeltas.clear();
  for (const entry of pending) applySubagentTextDelta(ctx, entry);
}
