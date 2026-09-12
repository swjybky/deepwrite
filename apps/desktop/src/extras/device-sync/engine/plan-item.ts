import {
  clockIncludes,
  mergeSyncClocks,
  mergeSyncItems,
  sameSyncContent,
  stableSyncJson,
  type SyncItem,
  type SyncIssue,
  type SyncMetadata,
  type SyncResolution,
  type SyncRevision
} from "@deepwrite/contracts";

export interface SyncCandidate {
  deviceId: string;
  revision: SyncRevision;
  item: SyncItem | null;
  deviceName: string;
}
type Baseline = SyncMetadata["baselines"][string];

function commonSyncAncestor(
  baseline: Baseline | undefined,
  ancestors: Baseline[],
  candidates: SyncCandidate[]
): SyncItem | null {
  if (!baseline) return null;
  const common = [...ancestors, baseline].filter(
    (entry) =>
      clockIncludes(baseline.revision.clock, entry.revision.clock) &&
      candidates.every((candidate) =>
        clockIncludes(candidate.revision.clock, entry.revision.clock)
      )
  );
  const latest = common.filter(
    (entry) =>
      !common.some(
        (other) =>
          clockIncludes(other.revision.clock, entry.revision.clock) &&
          !clockIncludes(entry.revision.clock, other.revision.clock)
      )
  );
  const first = latest[0];
  // Multiple incomparable common ancestors require explicit conflict handling.
  return first &&
    latest.every((entry) => sameSyncContent(entry.item, first.item))
    ? first.item
    : null;
}
export function latestSyncCandidates(
  entries: SyncCandidate[]
): SyncCandidate[] {
  return entries.filter(
    (entry, index) =>
      !entries.some(
        (other, j) =>
          j !== index &&
          clockIncludes(other.revision.clock, entry.revision.clock) &&
          (!clockIncludes(entry.revision.clock, other.revision.clock) ||
            (j < index && sameSyncContent(entry.item, other.item)))
      )
  );
}
export function planSyncItem(input: {
  key: string;
  local: SyncItem | null;
  baseline: SyncMetadata["baselines"][string] | undefined;
  ancestors?: Baseline[];
  candidates: SyncCandidate[];
  resolutions: SyncResolution[];
  hash(value: string): string;
}): {
  item: SyncItem | null;
  issue: SyncIssue | null;
  clocks: SyncRevision["clock"];
  candidates: SyncCandidate[];
} {
  const { key, local, baseline } = input;
  const candidates = latestSyncCandidates(input.candidates);
  const incoming = candidates.filter(
    (candidate) =>
      !baseline ||
      !clockIncludes(baseline.revision.clock, candidate.revision.clock)
  );
  const common = commonSyncAncestor(baseline, input.ancestors ?? [], incoming);
  const clocks = mergeSyncClocks([
    baseline?.revision.clock ?? {},
    ...candidates.map((v) => v.revision.clock)
  ]);
  const token = input.hash(
    stableSyncJson({ key, local, baseline, common, candidates })
  );
  const resolution = input.resolutions.find((value) => value.token === token);
  if (resolution)
    return { item: resolution.item, issue: null, clocks, candidates };
  let item = local;
  const conflicts: string[] = [];
  for (const candidate of candidates) {
    // A revision already incorporated in the local baseline cannot undo later local edits.
    if (
      baseline &&
      clockIncludes(baseline.revision.clock, candidate.revision.clock)
    ) {
      if (
        clockIncludes(candidate.revision.clock, baseline.revision.clock) &&
        !sameSyncContent(baseline.item, candidate.item)
      )
        conflicts.push("作品");
      continue;
    }
    const merged = mergeSyncItems(common, item, candidate.item);
    conflicts.push(...merged.conflicts);
    if (!merged.conflicts.length) item = merged.item;
  }
  const deletes = local !== null && item === null;
  const removesFiles =
    local !== null &&
    item !== null &&
    Object.keys(local.files).some((path) => item?.files[path] === undefined);
  if (!conflicts.length && !deletes && !removesFiles)
    return { item, issue: null, clocks, candidates };
  const identity = local ?? candidates.find((entry) => entry.item)?.item;
  return {
    item: local,
    clocks,
    candidates,
    issue: {
      key,
      title: identity?.title ?? baseline?.revision.title ?? key,
      token,
      reason: conflicts.length ? "conflict" : "delete",
      message: conflicts.length
        ? "两端修改需要确认，其他作品将继续同步。"
        : "另一端删除了内容，请确认后应用。",
      paths: [
        ...new Set(
          conflicts.length
            ? conflicts
            : Object.keys(local?.files ?? {}).filter(
                (path) => item?.files[path] === undefined
              )
        )
      ],
      local,
      base: common,
      versions: incoming.map((entry) => ({
        deviceName: entry.deviceName,
        item: entry.item,
        clock: entry.revision.clock
      }))
    }
  };
}
