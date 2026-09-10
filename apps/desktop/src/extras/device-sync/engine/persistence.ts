import {
  clockIncludes,
  stableSyncJson,
  type LoadedSyncDevice,
  type SyncMetadata,
  type SyncItem,
  type SyncIssue,
  type SyncServiceOptions
} from "@deepwrite/contracts";
import type { SyncRemote } from "./remote";

export async function publishSync(
  options: SyncServiceOptions,
  devices: LoadedSyncDevice[],
  issues: SyncIssue[],
  remote: SyncRemote,
  metadata: SyncMetadata,
  spaceId: string,
  items: NonNullable<SyncMetadata["published"]>["items"],
  accepted: SyncMetadata["baselines"],
  remoteSequence: number
): Promise<void> {
  const receipts = { ...metadata.published?.receipts };
  for (const { commit: source } of devices) {
    if (source.deviceId === metadata.deviceId) continue;
    if (
      Object.entries(source.items).every(([key, revision]) => {
        const incorporated = accepted[key]?.revision;
        return (
          incorporated && clockIncludes(incorporated.clock, revision.clock)
        );
      })
    )
      receipts[source.deviceId] = options.runtime.hash(
        stableSyncJson(source.items)
      );
  }
  let commit = {
    schemaVersion: 1 as const,
    spaceId,
    deviceId: metadata.deviceId,
    deviceName: metadata.config?.deviceName ?? "设备",
    sequence: Math.max(metadata.published?.sequence ?? 0, remoteSequence) + 1,
    createdAt: options.runtime.now(),
    items,
    receipts
  };
  const previous = devices.find(
    (entry) => entry.commit.deviceId === metadata.deviceId
  )?.commit;
  if (
    previous &&
    stableSyncJson({ items, receipts, name: commit.deviceName }) ===
      stableSyncJson({
        items: previous.items,
        receipts: previous.receipts,
        name: previous.deviceName
      })
  )
    commit = previous;
  else await remote.publish(commit);
  const ancestors = { ...metadata.ancestors };
  for (const key of Object.keys(accepted)) {
    const previous = metadata.baselines[key];
    if (!previous) continue;
    const records = ancestors[key] ?? [];
    if (
      !records.some(
        (entry) =>
          stableSyncJson(entry.revision) === stableSyncJson(previous.revision)
      )
    )
      ancestors[key] = [...records, previous];
  }
  await options.metadata.write({
    ...metadata,
    ancestors,
    published: commit,
    baselines: { ...metadata.baselines, ...accepted },
    history: metadata.history.map((entry) =>
      entry.description === "已准备上传本机修改"
        ? { ...entry, description: "本机修改已同步到网盘" }
        : entry
    ),
    pendingIssues: issues,
    lastSuccessAt: issues.length
      ? metadata.lastSuccessAt
      : options.runtime.now()
  });
}
export async function preserveSync(
  options: SyncServiceOptions,
  metadata: SyncMetadata,
  key: string,
  item: SyncItem | null,
  title: string,
  description: string
): Promise<SyncMetadata> {
  const next = {
    ...metadata,
    history: [
      {
        id: options.runtime.id(),
        key,
        title,
        at: options.runtime.now(),
        description,
        item
      },
      ...metadata.history
    ]
  };
  await options.metadata.write(next);
  return next;
}
