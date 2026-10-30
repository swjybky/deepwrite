import {
  createEnvelope,
  DecompositionIdSchema,
  DecompositionJobSettledEventSchema,
  type CommandEnvelope,
  type CommandResult,
  type DecompositionJobSettledEvent
} from "@deepwrite/contracts";

type Outcome = DecompositionJobSettledEvent["payload"]["outcome"];

const OBSERVED_JOB_LIMIT = 200;

function settledOutcome(
  status: string,
  lastError: unknown
): Outcome | undefined {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  // A stop the user asked for carries no error; a usage pause or exhausted
  // quota records why the task stopped.
  if (status === "stopped" && typeof lastError === "string" && lastError)
    return "paused";
  return undefined;
}

/**
 * Reports a task that settled by itself. A task is only reported when this
 * process saw it unsettled first, so reading an old finished task, or a
 * restart that finds one, never notifies.
 */
export function createDecompositionSettledEvents() {
  const observed = new Map<string, Outcome | "unsettled">();
  return (
    command: CommandEnvelope,
    result: CommandResult
  ): DecompositionJobSettledEvent | undefined => {
    if (result.status !== "accepted") return undefined;
    const job = result.payload;
    if (
      !job ||
      typeof job !== "object" ||
      Array.isArray(job) ||
      !("units" in job) ||
      !("status" in job) ||
      typeof job.status !== "string"
    )
      return undefined;
    const id = DecompositionIdSchema.safeParse("id" in job ? job.id : "");
    if (!id.success) return undefined;
    const outcome = settledOutcome(
      job.status,
      "lastError" in job ? job.lastError : undefined
    );
    const previous = observed.get(id.data);
    observed.delete(id.data);
    observed.set(id.data, outcome ?? "unsettled");
    if (observed.size > OBSERVED_JOB_LIMIT) {
      const oldest = observed.keys().next().value as string | undefined;
      if (oldest !== undefined) observed.delete(oldest);
    }
    if (!outcome || previous !== "unsettled") return undefined;
    return DecompositionJobSettledEventSchema.parse(
      createEnvelope(
        "decomposition.job_settled",
        { jobId: id.data, outcome },
        { id: `${command.id}-settled`, context: command.context }
      )
    );
  };
}
