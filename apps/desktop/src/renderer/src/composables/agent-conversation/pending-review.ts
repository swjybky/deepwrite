import { effectScope, watch } from "vue";
import { createScopedTranslator } from "../../i18n";
import type { ChatMessage } from "../../types/conversation";
import type { AgentConversationContext } from "./context";

const t = createScopedTranslator("workspace.sendMessage");

/** Accepting is a short local write; beyond this it is treated as lost. */
export const ACCEPTING_STALL_MS = 60_000;

/** Proposals that still hold the composer back: awaiting a decision or write. */
export function countPendingEditReviews(
  messages: readonly ChatMessage[]
): number {
  let count = 0;
  for (const message of messages) {
    for (const proposal of message.editProposals ?? []) {
      if (proposal.status === "pending" || proposal.status === "accepting")
        count += 1;
    }
  }
  return count;
}

type WatchdogContext = Pick<
  AgentConversationContext,
  "messages" | "updateEditProposal"
>;

/**
 * An `accepting` proposal whose write never settles would block sending for
 * good. After a stall it becomes a retryable error; a late completion cannot
 * overwrite it because settlement checks the decision token and status.
 */
export function createAcceptingWatchdog(
  ctx: WatchdogContext,
  stallMs = ACCEPTING_STALL_MS
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const scope = effectScope(true);
  const acceptingKeys = (): string[] =>
    ctx.messages.value.flatMap((message) =>
      (message.editProposals ?? [])
        .filter((proposal) => proposal.status === "accepting")
        .map((proposal) => `${proposal.runId}\u0000${proposal.id}`)
    );

  function expire(key: string): void {
    timers.delete(key);
    if (!acceptingKeys().includes(key)) return;
    const [runId, proposalId] = key.split("\u0000") as [string, string];
    ctx.updateEditProposal(runId, proposalId, {
      status: "error",
      statusMessage: t("acceptStalled")
    });
  }

  scope.run(() => {
    watch(
      acceptingKeys,
      (keys) => {
        for (const key of keys) {
          if (!timers.has(key))
            timers.set(
              key,
              setTimeout(() => expire(key), stallMs)
            );
        }
        for (const [key, timer] of timers) {
          if (keys.includes(key)) continue;
          clearTimeout(timer);
          timers.delete(key);
        }
      },
      { immediate: true }
    );
  });
  return () => {
    scope.stop();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
