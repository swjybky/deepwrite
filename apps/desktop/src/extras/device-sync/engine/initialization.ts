import { syncProgressTitle } from "../../../localization/sync-display-text";
import {
  clockIncludes,
  mergeSyncClocks,
  stableSyncJson,
  syncDependencies,
  syncErrorMessage,
  SyncItemValidationError,
  syncKey,
  type LoadedSyncDevice,
  type SyncInitializationPreview,
  type SyncItem,
  type SyncMetadata,
  type SyncRevision,
  type SyncServiceOptions
} from "@deepwrite/contracts";
import { connectedSyncRemote, loadSyncMetadata } from "./connection";
import { SyncContentIntegrityError } from "./content-store";
import type { SyncRunState } from "./run";

export interface PreparedSyncInitialization {
  preview: SyncInitializationPreview;
  items: SyncItem[];
  baselines: SyncMetadata["baselines"];
  ancestors: SyncMetadata["ancestors"];
  devices: LoadedSyncDevice[];
  localFingerprint: string;
  metadataFingerprint: string;
}
const TTL = 10 * 60 * 1000;
function metadataFingerprint(metadata: SyncMetadata): string {
  const { config, deviceId, published, baselines, history } = metadata;
  return stableSyncJson({ config, deviceId, published, baselines, history });
}
function deviceVersions(devices: LoadedSyncDevice[]): string {
  return stableSyncJson(
    devices.map(({ hash, commit }) => [commit.deviceId, hash]).sort()
  );
}
function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("同步已取消。");
}
function fileHashes(revision: SyncRevision): string {
  return stableSyncJson(
    revision.files
      ? Object.fromEntries(
          Object.entries(revision.files).map(([path, ref]) => [path, ref.hash])
        )
      : null
  );
}
function sanitizeLabel(value: string, maxLength: number): string {
  return value
    .replace(/[\r\n）]+/g, " ")
    .trim()
    .slice(0, maxLength);
}
function formatDeviceNames(names: readonly string[]): string {
  let result = "";
  for (const part of names) {
    const next = result ? `${result}、${part}` : part;
    if (next.length > 140) {
      return result
        ? `${result} 等 ${names.length} 台设备`.slice(0, 160)
        : next.slice(0, 160);
    }
    result = next;
  }
  return result.slice(0, 160);
}
function recordAncestor(
  ancestors: SyncMetadata["ancestors"],
  key: string,
  entry: { revision: SyncRevision; item: SyncItem | null }
): void {
  const list = ancestors[key] ?? [];
  if (
    !list.some(
      (existing) =>
        stableSyncJson(existing.revision) === stableSyncJson(entry.revision)
    )
  ) {
    ancestors[key] = [...list, entry];
  }
}
function validationDetail(error: unknown): string {
  if (!(error instanceof SyncItemValidationError)) return "";
  const detail = error.message.trim();
  return detail && detail.length <= 140 && !/[\r\n：]|https?:\/\//i.test(detail)
    ? detail
    : "";
}

/** Find peer devices other than this device whose uploaded revisions were not yet merged by the chosen source. */
function findUnmergedDevices(
  source: LoadedSyncDevice,
  devices: LoadedSyncDevice[],
  localDeviceId: string
): string[] {
  const names = new Set<string>();
  for (const { commit } of devices) {
    if (
      commit.deviceId === source.commit.deviceId ||
      commit.deviceId === localDeviceId
    )
      continue;
    for (const [key, revision] of Object.entries(commit.items)) {
      const chosen = source.commit.items[key];
      const diverged =
        (!chosen && Boolean(revision.files)) ||
        (chosen !== undefined &&
          !clockIncludes(chosen.clock, revision.clock)) ||
        (chosen !== undefined &&
          stableSyncJson(chosen.clock) === stableSyncJson(revision.clock) &&
          fileHashes(chosen) !== fileHashes(revision));
      if (diverged) {
        names.add(
          sanitizeLabel(commit.deviceName, 40) || commit.deviceId.slice(0, 40)
        );
        break;
      }
    }
  }
  return [...names];
}

export async function prepareSyncInitialization(
  options: SyncServiceOptions,
  state: SyncRunState,
  deviceId: string,
  signal: AbortSignal,
  initOptions?: { ignoreOtherDevices?: boolean }
): Promise<PreparedSyncInitialization> {
  const port = options.workspace.initialization;
  if (!port) throw new Error("当前环境不支持初始化本机。");
  const metadata = await loadSyncMetadata(options);
  if (!metadata.config?.spaceId) throw new Error("请先连接并选择同步空间。");
  state.progress = {
    phase: "checking",
    completed: 0,
    total: 0,
    ...syncProgressTitle("checkingSource")
  };
  await options.workspace.recover();
  const local = await port.inspect();
  const remote = await connectedSyncRemote(options, metadata.config, signal);
  const devices = await remote.devices(metadata.config.spaceId);
  const source = devices.find(
    ({ commit }) =>
      commit.deviceId === deviceId && deviceId !== metadata.deviceId
  );
  if (!source) throw new Error("请先选择另一台已上传数据的设备。");
  const unmergedDevices = findUnmergedDevices(
    source,
    devices,
    metadata.deviceId
  );
  if (unmergedDevices.length > 0 && !initOptions?.ignoreOtherDevices) {
    throw new Error(
      `远端设备（${formatDeviceNames(unmergedDevices)}）还有未合并的版本，请先在来源设备完成同步后重试，或选择忽略其他设备继续初始化。`
    );
  }
  const revisions = Object.entries(source.commit.items);
  const total = revisions.filter(([, revision]) => revision.files).length;
  if (!total)
    throw new Error("来源设备没有可下载的作品或资料，未清除本机数据。");
  const items: SyncItem[] = [];
  const baselines: SyncMetadata["baselines"] = {};
  const ancestors: SyncMetadata["ancestors"] = {};
  let skippedUnsupportedCount = 0;
  remote.setFileProgress((filesCompleted, filesTotal) => {
    state.progress = { ...state.progress, filesCompleted, filesTotal };
  });
  for (const [key, revision] of revisions) {
    checkCancelled(signal);
    state.progress = {
      phase: "transferring",
      completed: items.length,
      total,
      ...syncProgressTitle("downloadingSource", { title: revision.title })
    };
    try {
      const item = await remote.item(metadata.config.spaceId, revision);
      if (item && options.workspace.supportsItem?.(item) === false) {
        skippedUnsupportedCount++;
        baselines[key] = { revision, item: null };
        continue;
      }
      if (item) {
        await options.workspace.validate(item);
        items.push(item);
      }
      baselines[key] = { revision, item };
    } catch (error) {
      checkCancelled(signal);
      if (
        !(error instanceof SyncContentIntegrityError) &&
        !(error instanceof SyncItemValidationError) &&
        syncErrorMessage(error) !==
          "同步未完成，请检查连接、作品保存状态后重试。"
      ) {
        throw error;
      }
      const title = sanitizeLabel(revision.title, 60) || key.slice(0, 60);
      const detail = validationDetail(error);
      throw new Error(
        detail
          ? `远端作品不完整或不兼容（${title}）：${detail}`
          : `远端作品不完整或不兼容（${title}），请先在来源设备更新并重新上传。`
      );
    }
  }
  if (!items.length)
    throw new Error("来源设备没有可下载的作品或资料，未清除本机数据。");
  const keys = new Set(items.map(syncKey));
  if (
    items.some((item) => syncDependencies(item).some((key) => !keys.has(key)))
  ) {
    throw new Error(
      "远端作品绑定的资料不完整，请先在来源设备同步全部作品和资料库。"
    );
  }
  // Incorporate this device's prior commits, published tombstones, and (when explicitly ignored)
  // other unmerged peers' clocks while keeping the chosen source snapshot in `ancestors` for future 3-way merges.
  const supersededKeys = new Set<string>();
  for (const { commit } of devices) {
    if (commit.deviceId === source.commit.deviceId) continue;
    for (const [key, revision] of Object.entries(commit.items)) {
      const baseline = baselines[key];
      const includeDivergent =
        commit.deviceId === metadata.deviceId ||
        Boolean(initOptions?.ignoreOtherDevices);
      if (baseline) {
        if (!includeDivergent && revision.files) continue;
        const mergedClock = mergeSyncClocks([
          baseline.revision.clock,
          revision.clock
        ]);
        if (
          stableSyncJson(mergedClock) !==
          stableSyncJson(baseline.revision.clock)
        ) {
          const sourceRevision = source.commit.items[key];
          if (sourceRevision) {
            recordAncestor(ancestors, key, {
              revision: sourceRevision,
              item: baseline.item
            });
          }
          baselines[key] = {
            revision: { ...baseline.revision, clock: mergedClock },
            item: baseline.item
          };
          supersededKeys.add(key);
        }
        continue;
      }
      if (!revision.files || includeDivergent) {
        baselines[key] = {
          revision: {
            ...revision,
            clock: mergeSyncClocks([
              baselines[key]?.revision.clock ?? {},
              revision.clock
            ]),
            files: null
          },
          item: null
        };
        if (revision.files) supersededKeys.add(key);
      }
    }
  }
  for (const key of supersededKeys) {
    const entry = baselines[key];
    if (!entry) continue;
    entry.revision = {
      ...entry.revision,
      clock: {
        ...entry.revision.clock,
        [metadata.deviceId]: (entry.revision.clock[metadata.deviceId] ?? 0) + 1
      }
    };
  }
  checkCancelled(signal);
  const preview: SyncInitializationPreview = {
    token: options.runtime.id(),
    deviceId,
    deviceName: source.commit.deviceName,
    remoteUpdatedAt: source.commit.createdAt,
    remoteHash: source.hash,
    itemCount: items.length,
    fileCount: items.reduce(
      (sum, item) => sum + Object.keys(item.files).length,
      0
    ),
    localItemCount: local.itemCount,
    expiresAt: new Date(Date.parse(options.runtime.now()) + TTL).toISOString(),
    ...(initOptions?.ignoreOtherDevices && unmergedDevices.length
      ? { ignoredDevices: unmergedDevices }
      : {}),
    ...(skippedUnsupportedCount ? { skippedUnsupportedCount } : {})
  };
  state.progress = {
    phase: "idle",
    completed: items.length,
    total,
    ...syncProgressTitle("sourceReady")
  };
  return {
    preview,
    items,
    baselines,
    ancestors,
    devices,
    localFingerprint: local.fingerprint,
    metadataFingerprint: metadataFingerprint(metadata)
  };
}

export async function applySyncInitialization(
  options: SyncServiceOptions,
  state: SyncRunState,
  prepared: PreparedSyncInitialization | null,
  token: string,
  signal: AbortSignal
): Promise<void> {
  const port = options.workspace.initialization;
  if (!port) throw new Error("当前环境不支持初始化本机。");
  if (
    !prepared ||
    token !== prepared.preview.token ||
    Date.parse(options.runtime.now()) >= Date.parse(prepared.preview.expiresAt)
  ) {
    throw new Error("初始化预览已过期，请重新下载预览。");
  }
  const metadata = await loadSyncMetadata(options);
  if (
    !metadata.config?.spaceId ||
    metadataFingerprint(metadata) !== prepared.metadataFingerprint
  ) {
    throw new Error("本机数据已变化，请重新下载预览后确认。");
  }
  state.progress = {
    phase: "checking",
    completed: 0,
    total: prepared.items.length,
    ...syncProgressTitle("recheckingRemote")
  };
  const remote = await connectedSyncRemote(options, metadata.config, signal);
  const devices = await remote.devices(metadata.config.spaceId);
  if (deviceVersions(devices) !== deviceVersions(prepared.devices)) {
    throw new Error("远端数据已更新，请重新下载预览后确认。");
  }
  checkCancelled(signal);
  const at = options.runtime.now();
  const next: SyncMetadata = {
    ...metadata,
    config: { ...metadata.config, excludedKeys: [] },
    baselines: prepared.baselines,
    ancestors: prepared.ancestors,
    history: [],
    pendingIssues: [],
    devices,
    firstSyncConfirmed: true,
    lastCheckedAt: at,
    lastSuccessAt: at
  };
  state.progress = {
    phase: "applying",
    completed: 0,
    total: prepared.items.length,
    ...syncProgressTitle("replacingLocal")
  };
  await port.replace(prepared.items, next, prepared.localFingerprint, signal);
  state.issues = [];
  state.progress = {
    phase: "complete",
    completed: prepared.items.length,
    total: prepared.items.length,
    ...syncProgressTitle("initialized", {
      device: prepared.preview.deviceName,
      count: prepared.items.length
    })
  };
}
