import type {
  DecompositionContentRef,
  LongBookDecompositionJob
} from "@deepwrite/contracts";
import { sha256Hex } from "@deepwrite/shared/node";

/** The newest version any unit of this job wrote to a target resource. */
export function latestDecompositionRef(
  job: LongBookDecompositionJob,
  resourceId: string
): DecompositionContentRef | undefined {
  let latest: DecompositionContentRef | undefined;
  for (const unit of Object.values(job.units)) {
    const refs = unit.previousOutputRefs
      ? [...unit.previousOutputRefs, ...unit.outputRefs]
      : unit.outputRefs;
    for (const ref of refs)
      if (
        ref.resourceId === resourceId &&
        (!latest || ref.revision > latest.revision)
      )
        latest = ref;
  }
  return latest;
}

/**
 * Generated documents are plain prose. A write may replace one only while it
 * still equals the job's last written version; anything else is a user edit.
 */
export function assertDecompositionDocumentWritable(
  job: LongBookDecompositionJob,
  resourceId: string,
  current: string | undefined,
  next: string,
  replace = false
): void {
  if (!current?.trim() || replace) return;
  const latest = latestDecompositionRef(job, resourceId);
  if (
    latest
      ? latest.userOwned || latest.sha256 !== sha256Hex(current)
      : current !== next
  )
    throw new Error(`decomposition.conflict: ${resourceId} 已被编辑。`);
}

/** Index objects created by target preparation have no prior ref and stay writable. */
export function assertDecompositionObjectWritable(
  job: LongBookDecompositionJob,
  resourceId: string,
  currentSha: string | undefined,
  replace = false
): void {
  if (currentSha === undefined || replace) return;
  const latest = latestDecompositionRef(job, resourceId);
  if (latest && (latest.userOwned || latest.sha256 !== currentSha))
    throw new Error(`decomposition.conflict: ${resourceId} 已被编辑。`);
}

/** Older refs to a shared document are superseded by a later write; only the newest is checked. */
export function currentDecompositionRefs<T extends DecompositionContentRef>(
  refs: readonly T[]
): T[] {
  const newest = new Map<string, number>();
  for (const ref of refs) {
    const key = `${ref.projectId}:${ref.resourceId}`;
    newest.set(key, Math.max(newest.get(key) ?? -1, ref.revision));
  }
  return refs.filter(
    (ref) => newest.get(`${ref.projectId}:${ref.resourceId}`) === ref.revision
  );
}
