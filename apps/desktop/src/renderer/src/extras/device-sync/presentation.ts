import { createScopedTranslator } from "../../i18n";
import type { SyncStatus } from "@deepwrite/contracts/renderer";

const t = createScopedTranslator("extras.deviceSync");

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
    ? t("firstSyncAlignment")
    : status.progress.phase === "failed"
      ? t("latestStatusUnknown")
      : problems.length
        ? t("incompleteItems", { count: problems.length })
        : both.length
          ? t("conflictingItems", { count: both.length })
          : uploads.length
            ? t("pendingUploadCount", {
                count: uploads.length
              })
            : downloads.length
              ? t("pendingDownloadCount", {
                  count: downloads.length
                })
              : !status.lastCheckedAt
                ? t("localCleanRemoteUnchecked")
                : t("devicesSynced");
  const receipt = !peers.length
    ? t("noOtherSyncRecords")
    : awaiting.length
      ? t("devicesNotAcknowledged", {
          devices: awaiting.map((device) => device.name).join("、")
        })
      : t("otherDeviceAcknowledged");
  return { uploads, downloads, both, problems, adoptionKeys, title, receipt };
}

/** One switch in the sync scope list. */
export interface SyncScopeRow {
  key: string;
  title: string;
  included: boolean;
  dirty?: boolean;
  remoteDirty?: boolean;
}
