import {
  stableSyncJson,
  SyncItemValidationError,
  type SyncItem
} from "@deepwrite/contracts";
import {
  commitProjectTransaction,
  projectTransactionContentSha256,
  type ProjectTransactionFileOperation
} from "./project-transaction";
import { MAX_TRANSACTION_FILES } from "./project-transaction/types";

export const SYNC_FILE_LIMIT_MESSAGE =
  "作品文件数量超过同步上限，请减少单个作品的文件后重试。";

export function assertDeviceSyncFileCount(count: number): void {
  if (count > MAX_TRANSACTION_FILES)
    throw new SyncItemValidationError([], SYNC_FILE_LIMIT_MESSAGE);
}

/** Avoid rewriting unchanged files while retaining snapshot-wide compare guards. */
export function deviceSyncOperations(
  old: Record<string, string>,
  item: SyncItem
): ProjectTransactionFileOperation[] {
  const files = { ...item.files };
  const manifest: unknown = JSON.parse(files["deepwrite.json"] ?? "null");
  if (manifest && typeof manifest === "object" && "revision" in manifest) {
    const previous: unknown = JSON.parse(old["deepwrite.json"] ?? "null");
    const revision =
      previous &&
      typeof previous === "object" &&
      "revision" in previous &&
      typeof previous.revision === "number"
        ? previous.revision
        : 0;
    files["deepwrite.json"] =
      `${stableSyncJson({ ...manifest, revision: revision + 1 })}\n`;
  }
  const operations: ProjectTransactionFileOperation[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (old[path] === content) {
      operations.push({
        path,
        action: "check",
        expectedSha256: projectTransactionContentSha256(content)
      });
      continue;
    }
    operations.push({
      path,
      content,
      expectedSha256:
        old[path] === undefined
          ? null
          : projectTransactionContentSha256(old[path])
    });
  }
  for (const [path, content] of Object.entries(old))
    if (files[path] === undefined)
      operations.push({
        path,
        action: "delete",
        expectedSha256: projectTransactionContentSha256(content)
      });
  assertDeviceSyncFileCount(operations.length);
  return operations;
}

export async function commitDeviceSyncFiles(
  root: string,
  old: Record<string, string>,
  item: SyncItem
): Promise<void> {
  const operations = deviceSyncOperations(old, item);
  if (operations.length)
    await commitProjectTransaction({ projectRoot: root, operations });
}
