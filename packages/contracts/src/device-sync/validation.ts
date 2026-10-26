import { syncItemSchema, type SyncItem } from "./schemas";
import { parseSyncModelEntry, SYNC_MODEL_SECRET_FILE } from "./model-config";
import { safeSyncFile } from "./value";

export class SyncItemValidationError extends Error {
  constructor(
    readonly paths: string[],
    message = "作品缺少索引引用的文件，请在来源设备更新应用并重新上传。"
  ) {
    super(message);
  }
}

export function checkedSyncItem(value: unknown): SyncItem {
  const item = syncItemSchema.parse(value);
  if (
    !item.files["deepwrite.json"] ||
    Object.keys(item.files).some(
      (path) =>
        !safeSyncFile(path) &&
        !(item.kind === "model-config" && path === SYNC_MODEL_SECRET_FILE)
    )
  ) {
    throw new Error("同步作品包含不受支持的文件。");
  }
  if (item.kind === "model-config") parseSyncModelEntry(item);
  return item;
}

/** Items that live in a project folder; model configs are handled by Main. */
export type ProjectSyncItem = SyncItem & {
  kind: Exclude<SyncItem["kind"], "model-config">;
};

export function assertProjectSyncItem(
  item: SyncItem
): asserts item is ProjectSyncItem {
  if (item.kind === "model-config")
    throw new Error("同步作品包含不受支持的文件。");
}

export function projectSyncItems(
  items: readonly SyncItem[]
): ProjectSyncItem[] {
  return items.map((item) => {
    assertProjectSyncItem(item);
    return item;
  });
}
