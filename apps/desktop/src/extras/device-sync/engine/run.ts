import {
  syncProgressTitle,
  syncIssueMessage
} from "../../../localization/sync-display-text";
import {
  checkedSyncItem,
  sameSyncContent,
  syncKey,
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
import { indexSyncCandidates, readSyncCandidates } from "./candidates";
import { planSyncItem } from "./plan-item";
import { transferSyncItem } from "./transfer-item";
import { publishSync } from "./persistence";
import { directionConflict, syncItemDirection } from "./direction";
import { adoptSyncItem } from "./adoption";
import { syncDependencyIssue } from "./dependency-guard";

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
): Promise<{ works: { key: string; title: string }[] }> {
  let metadata = await loadSyncMetadata(options);
  const config = metadata.config;
  if (!config?.spaceId) throw new Error("请先连接并选择同步空间。");
  state.progress = {
    phase: "saving",
    completed: 0,
    total: 0,
    ...syncProgressTitle("checkingLocal")
  };
  await options.workspace.recover();
  const snapshot = await options.workspace.list();
  // Conversations follow the works this device held when the run started.
  const works = snapshot.items
    .filter((item) => item.kind === "book" || item.kind === "long-book")
    .map((item) => ({ key: syncKey(item), title: item.title }));
  state.progress = {
    ...state.progress,
    phase: "checking",
    ...syncProgressTitle("checkingRemote")
  };
  const remote = await connectedSyncRemote(options, config, signal);
  const devices = await remote.devices(config.spaceId, metadata.devices);
  metadata = {
    ...metadata,
    devices: devices,
    lastCheckedAt: options.runtime.now()
  };
  await options.metadata.write(metadata);
  remote.setFileProgress((filesCompleted, filesTotal) => {
    state.progress = { ...state.progress, filesCompleted, filesTotal };
  });
  const candidates = indexSyncCandidates(devices, config.excludedKeys);
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
    // Create dependencies first; delete referring works/groups before libraries.
    .sort(
      (a, b) =>
        (candidates.get(a)?.some((entry) => !entry.revision.files)
          ? 5 - syncDependencyOrder(a)
          : syncDependencyOrder(a)) -
        (candidates.get(b)?.some((entry) => !entry.revision.files)
          ? 5 - syncDependencyOrder(b)
          : syncDependencyOrder(b))
    );
  if (!metadata.firstSyncConfirmed && !confirmFirst) {
    state.issues.unshift({
      key: "__first__",
      ...syncProgressTitle("firstPreview"),
      token: "__first__",
      reason: "first-sync",
      ...syncIssueMessage("firstPreviewSummary", {
        local: snapshot.items.length,
        remote: candidates.size
      }),
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
      ...syncProgressTitle("confirmFirst")
    };
    return { works: [] };
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
    if (!adoption && baseline) await remote.reuseItems([baseline.item]);
    state.progress = {
      phase: "transferring",
      completed,
      total,
      ...syncProgressTitle("readingChanges", {
        title: initial?.title ?? candidates.get(key)?.[0]?.revision.title ?? key
      })
    };
    const loaded = await readSyncCandidates(
      remote,
      candidates.get(key) ?? [],
      config.spaceId,
      key,
      signal
    );
    state.issues.push(...loaded.issues);
    if (loaded.issues.length) continue;
    let plan = planSyncItem({
      key,
      local: initial,
      baseline: metadata.baselines[key],
      candidates: loaded.candidates,
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
      if (plan.item)
        await options.workspace.validate(checkedSyncItem(plan.item));
      const dependencyIssue = syncDependencyIssue({
        key,
        title: identity.title,
        initial,
        next: plan.item,
        local,
        accepted
      });
      if (dependencyIssue) {
        state.issues.push(dependencyIssue);
        continue;
      }
      state.progress = {
        phase: "transferring",
        completed,
        total,
        ...syncProgressTitle(
          sameSyncContent(initial, plan.item) ? "uploading" : "downloading",
          { title: identity.title }
        )
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
        ...syncIssueMessage(
          error instanceof SyncItemValidationError
            ? "validationFailed"
            : "transferFailed"
        ),
        ...(error instanceof SyncItemValidationError
          ? { message: error.message }
          : {}),
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
  state.progress = {
    phase: state.issues.length ? "partial" : "complete",
    completed,
    total,
    ...syncProgressTitle(
      state.issues.length
        ? "partialSummary"
        : completed
          ? "syncSummary"
          : "noChanges",
      { uploaded, downloaded, issues: state.issues.length }
    )
  };
  return { works };
}
