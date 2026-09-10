import {
  hasRemoteSyncChange,
  sameSyncContent,
  stableSyncJson,
  syncKey,
  type SyncIssue,
  type SyncMetadata,
  type SyncProgress,
  type SyncServiceOptions,
  type SyncStatus
} from "@deepwrite/contracts";

export async function readSyncStatus(
  options: SyncServiceOptions,
  metadata: SyncMetadata,
  progress: SyncProgress
): Promise<SyncStatus> {
  const local = await options.workspace.list();
  const localByKey = new Map(local.items.map((item) => [syncKey(item), item]));
  const revisions = metadata.devices.flatMap(({ commit }) =>
    Object.entries(commit.items)
  );
  const keys = new Set([
    ...localByKey.keys(),
    ...Object.keys(metadata.baselines),
    ...revisions.map(([key]) => key)
  ]);
  const items: SyncStatus["items"] = [];
  for (const key of keys) {
    const item = localByKey.get(key) ?? null;
    const baseline = metadata.baselines[key];
    const remote = revisions
      .filter(([id]) => id === key)
      .map(([, revision]) => revision);
    const identity = item ?? baseline?.item ?? remote[0];
    if (!identity) continue;
    const dirty = !sameSyncContent(baseline?.item ?? null, item);
    const remoteDirty = hasRemoteSyncChange(baseline, remote);
    if (!item && !dirty && !remoteDirty) continue;
    items.push({
      key,
      title: identity.title,
      kind: identity.kind,
      included: !metadata.config?.excludedKeys.includes(key),
      dirty,
      remoteDirty
    });
  }
  const currentHash = metadata.published
    ? options.runtime.hash(stableSyncJson(metadata.published.items))
    : null;
  return {
    config: metadata.config,
    credentialSaved: Boolean(await options.credentials.get()),
    deviceId: metadata.deviceId,
    firstSyncConfirmed: metadata.firstSyncConfirmed,
    lastSuccessAt: metadata.lastSuccessAt,
    lastCheckedAt: metadata.lastCheckedAt,
    progress,
    items,
    issues: [
      ...metadata.pendingIssues,
      ...local.issues
        .filter(
          (entry) => !metadata.pendingIssues.some((v) => v.key === entry.key)
        )
        .map((entry): SyncIssue => ({
          ...entry,
          token: "",
          reason: "unsupported",
          paths: [],
          local: null,
          versions: []
        }))
    ],
    devices: metadata.devices.map(({ commit }) => ({
      id: commit.deviceId,
      name: commit.deviceName,
      updatedAt: commit.createdAt,
      receivedCurrent:
        currentHash !== null &&
        commit.receipts[metadata.deviceId] === currentHash
    })),
    history: metadata.history.map(({ item, ...entry }) => ({
      ...entry,
      canRestore: item !== null
    }))
  };
}
