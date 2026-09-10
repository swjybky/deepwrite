import {
  sameSyncContent,
  stableSyncJson,
  type SyncItem,
  type SyncMetadata,
  type SyncServiceOptions
} from "@deepwrite/contracts";
import type { planSyncItem } from "./plan-item";
import type { SyncRemote } from "./remote";
import { preserveSync } from "./persistence";

export async function transferSyncItem(input: {
  options: SyncServiceOptions;
  remote: SyncRemote;
  metadata: SyncMetadata;
  key: string;
  initial: SyncItem | null;
  plan: ReturnType<typeof planSyncItem>;
  spaceId: string;
  identity: Pick<SyncItem, "kind" | "id" | "title">;
  signal: AbortSignal;
  applying(): void;
}) {
  const { options, remote, key, initial, plan, spaceId, identity, signal } =
    input;
  let metadata = input.metadata;
  const previous = plan.candidates.map((entry) => entry.revision);
  const unchanged = plan.candidates.find(
    (entry) =>
      sameSyncContent(entry.item, plan.item) &&
      stableSyncJson(entry.revision.clock) === stableSyncJson(plan.clocks)
  );
  const clock = unchanged
    ? plan.clocks
    : {
        ...plan.clocks,
        [metadata.deviceId]: (plan.clocks[metadata.deviceId] ?? 0) + 1
      };
  const revision =
    unchanged?.revision ??
    (await remote.revision(spaceId, plan.item, identity, clock, previous));
  if (signal.aborted) throw new Error("同步已取消。");
  if (!sameSyncContent(initial, plan.item)) {
    metadata = await preserveSync(
      options,
      metadata,
      key,
      initial,
      identity.title,
      "同步前的版本"
    );
    input.applying();
    await options.workspace.apply(key, initial, plan.item);
  }
  if (!sameSyncContent(metadata.baselines[key]?.item ?? null, plan.item)) {
    const received = !sameSyncContent(initial, plan.item);
    metadata = await preserveSync(
      options,
      metadata,
      key,
      plan.item,
      identity.title,
      received
        ? `从${plan.candidates.find((entry) => !sameSyncContent(initial, entry.item))?.deviceName ?? "网盘"}取回修改`
        : "已准备上传本机修改"
    );
  }
  return { metadata, revision };
}
