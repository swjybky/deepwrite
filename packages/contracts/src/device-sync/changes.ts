import type { SyncMetadata, SyncRevision } from "./schemas";
import { clockIncludes } from "./value";

export function hasRemoteSyncChange(
  baseline: SyncMetadata["baselines"][string] | undefined,
  revisions: SyncRevision[]
): boolean {
  return revisions.some(
    (revision) =>
      !baseline || !clockIncludes(baseline.revision.clock, revision.clock)
  );
}
