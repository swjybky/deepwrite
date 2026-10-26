import { syncIssueMessage } from "../../../localization/sync-display-text";
import {
  clockIncludes,
  syncErrorMessage,
  type LoadedSyncDevice,
  type SyncIssue
} from "@deepwrite/contracts";
import type { SyncCandidate } from "./plan-item";
import type { SyncRemote } from "./remote";
import { SyncContentIntegrityError } from "./content-store";

export function indexSyncCandidates(
  devices: LoadedSyncDevice[],
  excludedKeys: string[] = []
) {
  const result = new Map<string, Omit<SyncCandidate, "item">[]>();
  for (const { commit } of devices)
    for (const [key, revision] of Object.entries(commit.items)) {
      if (excludedKeys.includes(key)) continue;
      const entries = result.get(key) ?? [];
      entries.push({
        revision,
        deviceId: commit.deviceId,
        deviceName: commit.deviceName
      });
      result.set(key, entries);
    }
  return result;
}

export async function readSyncCandidates(
  remote: SyncRemote,
  entries: Omit<SyncCandidate, "item">[],
  spaceId: string,
  key: string,
  signal: AbortSignal
): Promise<{ candidates: SyncCandidate[]; issues: SyncIssue[] }> {
  const candidates: SyncCandidate[] = [];
  const issues: SyncIssue[] = [];
  for (const entry of entries) {
    const { revision } = entry;
    // Superseded revisions cannot affect the merge; avoid fetching their packs.
    if (
      entries.some(
        (other) =>
          clockIncludes(other.revision.clock, revision.clock) &&
          !clockIncludes(revision.clock, other.revision.clock)
      )
    )
      continue;
    try {
      const item = await remote.item(spaceId, revision);
      candidates.push({
        ...entry,
        revision,
        item
      });
    } catch (error) {
      if (signal.aborted) throw new Error("同步已取消。");
      issues.push({
        key,
        title: revision.title,
        token: "",
        reason: "failed",
        ...syncIssueMessage(
          error instanceof SyncContentIntegrityError
            ? "remoteInvalid"
            : "remoteReadFailed",
          error instanceof SyncContentIntegrityError
            ? undefined
            : { reason: syncErrorMessage(error) }
        ),
        paths: [],
        local: null,
        versions: []
      });
    }
  }
  return { candidates, issues };
}
