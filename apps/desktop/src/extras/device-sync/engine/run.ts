import {
  checkedSyncItem,
  sameSyncContent,
  syncKey,
  syncDependencies,
  syncDependencyOrder,
  SyncItemValidationError,
  type SyncAdoption,
  type SyncDirection,
  type SyncIssue,
  type SyncProgress,
  type SyncResolution,
  type SyncServiceOptions,
  type SyncMetadata
} from "@deepwrite/contracts";
import { connectedSyncRemote, loadSyncMetadata } from "./connection";
import { readSyncCandidates } from "./candidates";
import { planSyncItem } from "./plan-item";
import { transferSyncItem } from "./transfer-item";
import { publishSync } from "./persistence";
import { directionConflict, syncItemDirection } from "./direction";
import { adoptSyncItem } from "./adoption";

export interface SyncRunState {
  progress: SyncProgress;
  issues: SyncIssue[];
}
export async function runSync(
  options: SyncServiceOptions,
  state: SyncRunState,
  resolutions: SyncResolution[],
  confirmFirst: boolean,
  direction: SyncDirection,
  signal: AbortSignal,
  adoption?: SyncAdoption
): Promise<void> {
  let metadata = await loadSyncMetadata(options);
  const config = metadata.config;
  if (!config?.spaceId) throw new Error("请先连接并选择同步空间。");
  state.progress = {
    phase: "saving",
    completed: 0,
    total: 0,
    title: "检查本地保存状态"
  };
  await options.workspace.recover();
  const snapshot = await options.workspace.list();
  state.progress = {
    ...state.progress,
    phase: "checking",
    title: "检查网盘修改"
  };
  const remote = await connectedSyncRemote(options, config, signal);
  const devices = await remote.devices(config.spaceId);
  metadata = {
    ...metadata,
    devices: devices,
    lastCheckedAt: options.runtime.now()
  };
  await options.metadata.write(metadata);
  remote.setFileProgress((filesCompleted, filesTotal) => {
    state.progress = { ...state.progress, filesCompleted, filesTotal };
  });
  const loaded = await readSyncCandidates(
    remote,
    devices,
    config.spaceId,
    config.excludedKeys,
    signal
  );
  const candidates = loaded.candidates;
  state.issues.push(...loaded.issues);
  const selected = adoption ? new Set(adoption.keys) : null;
  if (selected)
    state.issues.push(
      ...metadata.pendingIssues.filter(
        (issue) =>
          issue.reason !== "first-sync" &&
          !selected.has(issue.key) &&
          !state.issues.some((entry) => entry.key === issue.key)
      )
    );
  const local = new Map(snapshot.items.map((item) => [syncKey(item), item]));
  for (const entry of snapshot.issues)
    state.issues.push({
      ...entry,
      token: "",
      reason: "unsupported",
      paths: [],
      local: null,
      versions: []
    });
  const keys = [
    ...new Set([
      ...local.keys(),
      ...candidates.keys(),
      ...Object.keys(metadata.baselines)
    ])
  ]
    .filter((key) => !config.excludedKeys.includes(key))
    .sort(
      (a, b) =>
        (candidates.get(a)?.some((entry) => !entry.item)
          ? 3
          : syncDependencyOrder(a)) -
        (candidates.get(b)?.some((entry) => !entry.item)
          ? 3
          : syncDependencyOrder(b))
    );
  if (!metadata.firstSyncConfirmed && !confirmFirst) {
    state.issues.unshift({
      key: "__first__",
      title: "首次同步预览",
      token: "__first__",
      reason: "first-sync",
      message: `本机 ${snapshot.items.length} 项，网盘 ${candidates.size} 项；按作品身份合并，同名的不同作品会分别保留。`,
      paths: keys.map(
        (key) =>
          local.get(key)?.title ??
          candidates.get(key)?.[0]?.revision.title ??
          key
      ),
      local: null,
      versions: []
    });
    state.progress = {
      phase: "partial",
      completed: 0,
      total: keys.length,
      title: "确认首次同步内容"
    };
    return;
  }
  metadata = { ...metadata, firstSyncConfirmed: true };
  await options.metadata.write(metadata);
  const own = devices.find(
    (device) => device.commit.deviceId === metadata.deviceId
  )?.commit;
  const published = { ...(own?.items ?? metadata.published?.items ?? {}) };
  const accepted: SyncMetadata["baselines"] = {};
  let completed = 0;
  let uploaded = 0;
  let downloaded = 0;
  const total = keys.filter((key) => {
    if (selected && !selected.has(key)) return false;
    const change = syncItemDirection(
      direction,
      local.get(key) ?? null,
      metadata.baselines[key],
      candidates.get(key) ?? []
    );
    return !change.skip && (change.upload || change.download);
  }).length;
  for (const key of keys) {
    if (signal.aborted) throw new Error("同步已取消。");
    if (state.issues.some((entry) => entry.key === key)) continue;
    const initial = local.get(key) ?? null;
    const change = syncItemDirection(
      direction,
      initial,
      metadata.baselines[key],
      candidates.get(key) ?? []
    );
    if (change.skip) continue;
    const baseline = metadata.baselines[key];
    if (!change.upload && !change.download && baseline) {
      accepted[key] = baseline;
      published[key] = baseline.revision;
      continue;
    }
    if (selected && !selected.has(key)) continue;
    let plan = planSyncItem({
      key,
      local: initial,
      baseline: metadata.baselines[key],
      candidates: candidates.get(key) ?? [],
      ancestors: metadata.ancestors[key] ?? [],
      resolutions,
      hash: options.runtime.hash
    });
    if (adoption)
      plan = adoptSyncItem({
        side: adoption.side,
        key,
        local: initial,
        metadata,
        plan
      });
    if (plan.issue) {
      state.issues.push(plan.issue);
      continue;
    }
    if (
      direction !== "both" &&
      change.upload &&
      change.download &&
      !sameSyncContent(initial, plan.item)
    ) {
      state.issues.push(directionConflict(key, initial, plan.candidates));
      continue;
    }
    try {
      const identity =
        plan.item ??
        initial ??
        plan.candidates[0]?.revision ??
        metadata.baselines[key]?.revision;
      if (!identity) continue;
      if (plan.item) {
        await options.workspace.validate(checkedSyncItem(plan.item));
        const missing = syncDependencies(plan.item).filter((dependency) =>
          accepted[dependency]
            ? !accepted[dependency]?.item
            : !local.has(dependency)
        );
        if (missing.length) {
          state.issues.push({
            key,
            title: plan.item.title,
            token: "",
            reason: "unsupported",
            message: "绑定的资料尚未就绪，请加入对应资料库并处理其同步事项。",
            paths: missing,
            local: initial,
            versions: []
          });
          continue;
        }
      }
      if (!plan.item) {
        const live = new Map(local);
        for (const [id, value] of Object.entries(accepted)) {
          if (value.item) live.set(id, value.item);
          else live.delete(id);
        }
        if (
          [...live.values()].some(
            (item) =>
              syncKey(item) !== key && syncDependencies(item).includes(key)
          )
        ) {
          state.issues.push({
            key,
            title: identity.title,
            token: "",
            reason: "unsupported",
            message: "仍有作品绑定此资料，请先取消绑定或保留资料后再同步删除。",
            paths: [],
            local: initial,
            versions: []
          });
          continue;
        }
      }
      state.progress = {
        phase: "transferring",
        completed,
        total,
        title: `${sameSyncContent(initial, plan.item) ? "上传到远端" : "下载到本机"}：${identity.title}`
      };
      const result = await transferSyncItem({
        options: options,
        remote,
        metadata,
        key,
        initial,
        plan,
        spaceId: config.spaceId,
        identity,
        signal,
        applying: () => {
          state.progress = { ...state.progress, phase: "applying" };
        }
      });
      metadata = result.metadata;
      published[key] = result.revision;
      accepted[key] = { revision: result.revision, item: plan.item };
      if (change.upload || change.download) {
        completed++;
        if (adoption ? adoption.side === "local" : change.upload) uploaded++;
        if (!sameSyncContent(initial, plan.item)) downloaded++;
      }
    } catch (error) {
      metadata = await loadSyncMetadata(options);
      if (signal.aborted) throw new Error("同步已取消。");
      state.issues.push({
        key,
        title: initial?.title ?? plan.candidates[0]?.revision.title ?? key,
        token: "",
        reason: "failed",
        message:
          error instanceof SyncItemValidationError
            ? error.message
            : "该作品正在写入、已发生新修改或结构不兼容，请保存后重试。",
        paths: error instanceof SyncItemValidationError ? error.paths : [],
        local: initial,
        versions: []
      });
    }
  }
  await publishSync(
    options,
    devices,
    state.issues,
    remote,
    metadata,
    config.spaceId,
    published,
    accepted,
    own?.sequence ?? 0
  );
  const summary = `已上传 ${uploaded} 项，已下载 ${downloaded} 项`;
  state.progress = {
    phase: state.issues.length ? "partial" : "complete",
    completed,
    total,
    title: state.issues.length
      ? `${summary}，${state.issues.length} 项未完成`
      : completed
        ? summary
        : "检查完成，没有需要传输的修改"
  };
}
