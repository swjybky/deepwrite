import { syncItemSchema, type SyncItem } from "./schemas";
import { safeSyncFile } from "./value";

export class SyncItemValidationError extends Error {
  constructor(readonly paths: string[]) {
    super("作品缺少索引引用的文件，请在来源设备更新应用并重新上传。");
  }
}

export function checkedSyncItem(value: unknown): SyncItem {
  const item = syncItemSchema.parse(value);
  if (
    !item.files["deepwrite.json"] ||
    Object.keys(item.files).some((path) => !safeSyncFile(path))
  ) {
    throw new Error("同步作品包含不受支持的文件。");
  }
  return item;
}
