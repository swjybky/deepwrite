import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Whether a manual `/compact` is running, and how it turned out.
 *
 * Lives in a store rather than in the composer because the two ends are far
 * apart: the composer starts the command, but the outcome arrives as a system
 * event handled in `WorkspaceShell`. The command itself returns immediately —
 * compaction is a whole summarising request — so the composer cannot await it
 * and must be told when to stop showing progress.
 */
export const useContextCompactionStore = defineStore("contextCompaction", () => {
  const running = ref(false);
  /** Last finished compaction, kept so the composer can show it inline. */
  const lastOutcome = ref<
    | { kind: "compacted"; tokensBefore: number; tokensAfter: number }
    | { kind: "failed"; reason: string }
    | null
  >(null);

  function begin(): void {
    running.value = true;
    lastOutcome.value = null;
  }

  function finish(
    outcome:
      | { kind: "compacted"; tokensBefore: number; tokensAfter: number }
      | { kind: "failed"; reason: string }
  ): void {
    running.value = false;
    lastOutcome.value = outcome;
  }

  function clear(): void {
    lastOutcome.value = null;
  }

  return { running, lastOutcome, begin, finish, clear };
});
