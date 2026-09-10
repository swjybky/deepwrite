import type { LoadedSyncDevice, SyncIssue } from "@deepwrite/contracts";
import type { SyncCandidate } from "./plan-item";
import type { SyncRemote } from "./remote";

export async function readSyncCandidates(
  remote: SyncRemote,
  devices: LoadedSyncDevice[],
  spaceId: string,
  excludedKeys: string[],
  signal: AbortSignal
): Promise<{ candidates: Map<string, SyncCandidate[]>; issues: SyncIssue[] }> {
  const candidates = new Map<string, SyncCandidate[]>();
  const issues: SyncIssue[] = [];
  for (const device of devices)
    for (const [key, revision] of Object.entries(device.commit.items)) {
      if (excludedKeys.includes(key)) continue;
      try {
        const item = await remote.item(spaceId, revision);
        const entries = candidates.get(key) ?? [];
        entries.push({ revision, item, deviceName: device.commit.deviceName });
        candidates.set(key, entries);
      } catch {
        if (signal.aborted) throw new Error("同步已取消。");
        issues.push({
          key,
          title: revision.title,
          token: "",
          reason: "failed",
          message: "网盘中的作品未通过完整性校验，本次未改动该作品。",
          paths: [],
          local: null,
          versions: []
        });
      }
    }
  return { candidates, issues };
}
