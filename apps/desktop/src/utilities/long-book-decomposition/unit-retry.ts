import type { LongBookDecompositionJob } from "@deepwrite/contracts";

/** Keep prior refs for CAS while regenerating the evidence-dependent stages. */
export function requeueDecompositionUnit(
  job: LongBookDecompositionJob,
  unitId: string
) {
  const unit = job.units[unitId]!;
  const phase = unit.phase;
  const suffix = `:retry:${Date.now()}`;
  const stages = ["read", "registry", "integrate", "review", "finalize"];
  const changed = new Set([unitId]);
  if (unitId.startsWith("reading:")) {
    for (const [id, candidate] of Object.entries(job.units))
      if (candidate.dependencies.includes(unitId)) changed.add(id);
  }
  for (const [id, candidate] of Object.entries(job.units)) {
    if (candidate.status === "skipped" && !changed.has(id)) continue;
    if (
      changed.has(id) ||
      stages.indexOf(candidate.phase) > stages.indexOf(phase)
    ) {
      candidate.status = "pending";
      candidate.attempts = 0;
      candidate.inputRevision =
        candidate.inputRevision.split(":retry:")[0]! + suffix;
      delete candidate.attemptId;
      delete candidate.runId;
      delete candidate.requiredReceiptIds;
      delete candidate.lastError;
    }
  }
  job.phase = phase;
  job.status = "idle";
  delete job.activeAttemptId;
  delete job.lastError;
}
