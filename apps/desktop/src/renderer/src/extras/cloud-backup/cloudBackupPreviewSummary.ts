import type { CloudBackupChange } from "@deepwrite/contracts";

export const CLOUD_BACKUP_CHANGE_ORDER = [
  "add",
  "overwrite",
  "keep",
  "drop"
] as const satisfies readonly CloudBackupChange["change"][];

export const CLOUD_BACKUP_CHANGE_LABELS: Record<
  CloudBackupChange["change"],
  string
> = {
  add: "将新增",
  overwrite: "将覆盖",
  keep: "不会改动",
  drop: "云端将移除"
};

export interface CloudBackupPreviewStatusSummary {
  change: CloudBackupChange["change"];
  label: string;
  count: number;
}

export interface CloudBackupPreviewSummary {
  total: number;
  statuses: CloudBackupPreviewStatusSummary[];
}

export function summarizeCloudBackupPreview(
  changes: readonly CloudBackupChange[]
): CloudBackupPreviewSummary {
  const counts: Record<CloudBackupChange["change"], number> = {
    add: 0,
    overwrite: 0,
    keep: 0,
    drop: 0
  };

  for (const item of changes) {
    counts[item.change] += 1;
  }

  return {
    total: changes.length,
    statuses: CLOUD_BACKUP_CHANGE_ORDER.map((change) => ({
      change,
      label: CLOUD_BACKUP_CHANGE_LABELS[change],
      count: counts[change]
    }))
  };
}
