import {
  decompositionTaskUnitIds,
  getModelContentBlockReason,
  isModelQuotaExhausted,
  type DeepWriteApi,
  type LongBookDecompositionJob
} from "@deepwrite/contracts/renderer";
import { startExtrasAgentTask } from "../agent-runtime/extrasAgentTask";
import type { createSubagentRunTracker } from "../agent-runtime/subagentRunTracker";
import { getErrorPayload } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";

const t = createScopedTranslator("extras.longBookDecomposition");

export const decompositionFailureMessage = (cause: unknown): string =>
  getErrorPayload(cause)?.message ??
  (cause instanceof Error
    ? getErrorPayload(cause.cause)?.message
    : undefined) ??
  formatError(cause, String(cause));

function capacityError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const value = cause as { code?: unknown; cause?: unknown };
  return (
    value.code === "agent.capacity_reached" ||
    value.code === "agent.extras_capacity_reached" ||
    (value.cause && value.cause !== cause ? capacityError(value.cause) : false)
  );
}

/** One package's admission, child events and terminal outcome. */
export function startDecompositionPackage(
  api: DeepWriteApi,
  current: LongBookDecompositionJob,
  phase: "read" | "registry" | "integrate" | "review",
  unitIds: string[],
  subtasks: ReturnType<typeof createSubagentRunTracker>,
  callbacks: {
    onAccepted(snapshot: Promise<LongBookDecompositionJob>): void;
    onOutput(): void;
  }
) {
  const chosen =
    phase === "read" ? current.models.reading : current.models.integration;
  let acceptedJob: Promise<LongBookDecompositionJob> | undefined;
  let quotaFailure: string | undefined;
  const runUnits = new Map<string, string[]>();
  const unitErrors = new Map<string, string>();
  subtasks.begin({ phase, unitIds });
  const handle = startExtrasAgentTask(
    api,
    {
      modelId: chosen.modelId,
      thinkingLevel: chosen.thinkingLevel,
      task: {
        agentId: "long-book-decomposition",
        profileId: current.profile.id,
        input: { jobId: current.id, phase, unitIds }
      }
    },
    {
      onAccepted: () => {
        acceptedJob = api.longBookDecomposition.getJob(current.id);
        callbacks.onAccepted(acceptedJob);
      },
      ...subtasks.parentCallbacks,
      onSubagentEvent: (event) => {
        subtasks.handleEvent(event);
        if (event.type === "subagent.started") {
          runUnits.set(
            event.payload.subagentRunId,
            decompositionTaskUnitIds(event.payload.task, unitIds)
          );
          return;
        }
        if (
          event.type !== "subagent.completed" ||
          event.payload.status !== "error"
        )
          return;
        const message = (
          event.payload.errorMessage ?? event.payload.summary
        ).trim();
        if (message) {
          for (const id of runUnits.get(event.payload.subagentRunId) ?? []) {
            const existing = unitErrors.get(id);
            if (!existing || !getModelContentBlockReason(existing))
              unitErrors.set(id, message.slice(0, 2000));
          }
        }
        if (quotaFailure || !isModelQuotaExhausted(message)) return;
        quotaFailure = message;
        // The parent may still be waiting for other children or another model
        // turn. Stop the whole package as soon as account exhaustion is known.
        handle.dispose();
      },
      onOutput: callbacks.onOutput
    }
  );
  const outcome = (async () => {
    let failure: string | undefined;
    let capacity = false;
    let stopped = false;
    let quota = false;
    try {
      stopped = (await handle.outcome).status === "stopped";
    } catch (cause) {
      capacity = capacityError(cause);
      quota = isModelQuotaExhausted(cause);
      failure = decompositionFailureMessage(cause);
    }
    if (quotaFailure) {
      quota = true;
      failure = quotaFailure;
    }
    if (quota) failure = t("quotaError", { reason: failure ?? "" });
    subtasks.end(
      quota || stopped || capacity
        ? "stopped"
        : failure
          ? "failed"
          : "completed",
      failure
    );
    return {
      failure,
      capacity,
      stopped,
      quota,
      unitErrors: Object.fromEntries(unitErrors)
    };
  })();
  return {
    handle,
    outcome,
    claimedJob: () => acceptedJob?.catch(() => undefined)
  };
}
