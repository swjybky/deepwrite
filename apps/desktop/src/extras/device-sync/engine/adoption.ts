import {
  sameSyncContent,
  type SyncAdoptionSide,
  type SyncItem,
  type SyncMetadata
} from "@deepwrite/contracts";
import { latestSyncCandidates, type planSyncItem } from "./plan-item";

/** A side choice replaces the whole selected item, using freshly verified versions. */
export function adoptSyncItem(input: {
  side: SyncAdoptionSide;
  key: string;
  local: SyncItem | null;
  metadata: SyncMetadata;
  plan: ReturnType<typeof planSyncItem>;
}): ReturnType<typeof planSyncItem> {
  const { side, key, local, metadata, plan } = input;
  if (side === "local" && (local || metadata.baselines[key]?.item)) {
    return { ...plan, item: local, issue: null };
  }
  const versions = latestSyncCandidates(
    plan.candidates.filter((entry) => entry.deviceId !== metadata.deviceId)
  );
  const remote = versions[0];
  if (
    side === "remote" &&
    remote &&
    versions.every((entry) => sameSyncContent(entry.item, remote.item))
  ) {
    return { ...plan, item: remote.item, issue: null };
  }
  return {
    ...plan,
    item: local,
    issue: {
      key,
      title:
        local?.title ??
        remote?.revision.title ??
        metadata.baselines[key]?.revision.title ??
        key,
      token: "",
      reason: "conflict",
      paths: [],
      local,
      message:
        side === "local"
          ? "本机没有可采用的版本，未将缺失内容作为删除同步。"
          : remote
            ? "多台远端设备的版本仍不一致，请先在来源设备同步，或采用本地版本。"
            : "远端没有可采用的版本，请先在另一端上传后重试。",
      versions: versions.map((entry) => ({
        deviceName: entry.deviceName,
        item: entry.item,
        clock: entry.revision.clock
      }))
    }
  };
}
