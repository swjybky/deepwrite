import { expect, it } from "vitest";
import { SyncItemValidationError, type SyncItem } from "@deepwrite/contracts";
import { deviceSyncOperations } from "./device-sync-transaction";
import { projectTransactionContentSha256 } from "./project-transaction";
import { MAX_TRANSACTION_FILES } from "./project-transaction/types";

function item(files: Record<string, string>): SyncItem {
  return {
    kind: "book",
    id: "book_fixture",
    title: "合成作品",
    files: { "deepwrite.json": "{}", ...files }
  };
}
it("未变化文件只检查，更新和删除仍携带旧文件的并发校验", () => {
  const previous = item({
    "unchanged.md": "保留",
    "draft.md": "旧正文",
    "removed.md": "旧文件"
  });
  const next = item({
    "unchanged.md": "保留",
    "draft.md": "新正文",
    "created.md": "新文件"
  });
  expect(deviceSyncOperations(previous.files, next)).toEqual([
    {
      path: "deepwrite.json",
      action: "check",
      expectedSha256: projectTransactionContentSha256("{}")
    },
    {
      path: "unchanged.md",
      action: "check",
      expectedSha256: projectTransactionContentSha256("保留")
    },
    {
      path: "draft.md",
      content: "新正文",
      expectedSha256: projectTransactionContentSha256("旧正文")
    },
    { path: "created.md", content: "新文件", expectedSha256: null },
    {
      path: "removed.md",
      action: "delete",
      expectedSha256: projectTransactionContentSha256("旧文件")
    }
  ]);
});
it("接受事务上限以内的完整初始快照，并在计算包含删除的操作数时拒绝超限", () => {
  const files = Object.fromEntries(
    Array.from({ length: MAX_TRANSACTION_FILES - 1 }, (_, i) => [
      `next_${i}.md`,
      "合成内容"
    ])
  );
  const next = item(files);
  expect(deviceSyncOperations({}, next)).toHaveLength(MAX_TRANSACTION_FILES);
  const old = Object.fromEntries(
    Array.from({ length: MAX_TRANSACTION_FILES - 1 }, (_, i) => [
      `old_${i}.md`,
      "合成内容"
    ])
  );
  expect(() => deviceSyncOperations(item(old).files, next)).toThrow(
    SyncItemValidationError
  );
  const changed = { ...next, files: { ...next.files, "next_0.md": "更新" } };
  const operations = deviceSyncOperations(next.files, changed);
  expect(
    operations.filter((operation) => operation.action !== "check")
  ).toHaveLength(1);
  expect(operations).toHaveLength(MAX_TRANSACTION_FILES);
});
