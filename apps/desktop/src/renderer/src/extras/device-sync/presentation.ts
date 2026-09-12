import type { SyncStatus } from "@deepwrite/contracts/renderer";

export function syncPresentation(status: SyncStatus) {
  const included = status.items.filter((item) => item.included);
  const uploads = included.filter((item) => item.dirty && !item.remoteDirty);
  const downloads = included.filter((item) => item.remoteDirty && !item.dirty);
  const both = included.filter((item) => item.dirty && item.remoteDirty);
  const problems = status.issues.filter(
    (issue) => issue.reason !== "first-sync"
  );
  const adoptionKeys = [
    ...new Set([...both, ...problems].map((item) => item.key))
  ].filter((key) => !status.config?.excludedKeys.includes(key));
  const peers = status.devices.filter(
    (device) => device.id !== status.deviceId
  );
  const awaiting = peers.filter((device) => !device.receivedCurrent);
  const title = !status.firstSyncConfirmed
    ? "首次同步：对齐所选内容"
    : status.progress.phase === "failed"
      ? "操作未完成，暂不能确认最新状态"
      : problems.length
        ? `${problems.length} 项同步未完成`
        : both.length
          ? `${both.length} 项两端都有修改`
          : uploads.length
            ? `${uploads.length} 项本机修改待上传`
            : downloads.length
              ? `${downloads.length} 项远端更新待下载`
              : !status.lastCheckedAt
                ? "本机无待上传修改，尚未检查远端"
                : "本机与远端已同步";
  const receipt = !peers.length
    ? "尚未发现另一台设备的同步记录"
    : awaiting.length
      ? `${awaiting.map((device) => device.name).join("、")}尚未确认取回本机最新提交`
      : "另一端已确认取回本机最新提交";
  return { uploads, downloads, both, problems, adoptionKeys, title, receipt };
}
