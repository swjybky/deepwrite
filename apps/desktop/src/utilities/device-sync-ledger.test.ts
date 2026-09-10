import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { syncItemSchema, sameSyncContent } from "@deepwrite/contracts";
import {
  makeTemporaryRoot,
  join,
  it as test,
  expect
} from "./folder-catalog-store.test-support";
import {
  readDeviceSyncFiles,
  validateDesktopSyncItem
} from "./device-sync-files";

async function fixture() {
  const path = fileURLToPath(
    new URL("./fixtures/device-sync-ledger.json", import.meta.url)
  );
  return syncItemSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

test("桌面导出包含章节账本 JSON；缺失引用会在上传前明确拒绝", async () => {
  const item = await fixture();
  expect(() => validateDesktopSyncItem(item)).not.toThrow();
  const root = await makeTemporaryRoot("deepwrite-sync-ledger-");
  for (const [path, text] of Object.entries(item.files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const files = await readDeviceSyncFiles(root);
  expect(sameSyncContent({ ...item, files }, item)).toBe(true);
  const ledger = Object.keys(files).find((path) =>
    path.startsWith("long/ledger/")
  );
  if (!ledger) throw new Error("Missing fixture ledger");
  delete files[ledger];
  expect(() => validateDesktopSyncItem({ ...item, files })).toThrow(
    "作品缺少索引引用的文件"
  );
});
