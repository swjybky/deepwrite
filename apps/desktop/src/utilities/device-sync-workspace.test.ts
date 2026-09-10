import { readFile, writeFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DeviceSyncInventorySchema,
  syncItemSchema,
  sameSyncContent,
  syncKey
} from "@deepwrite/contracts";
import {
  catalogFixture,
  FolderCatalogStore,
  makeTemporaryRoot,
  join,
  describe,
  it,
  expect
} from "./folder-catalog-store.test-support";
import { LongWorkspaceService } from "./long-workspace-service";
import { DesktopSyncWorkspace } from "./device-sync-workspace";
import { syncRegistrations } from "./device-sync-inventory";
import { validateDesktopSyncItem } from "./device-sync-files";

const mobileFixturePath = fileURLToPath(
  new URL("./fixtures/device-sync-mobile.json", import.meta.url)
);
async function fixture() {
  const root = await realpath(
    await makeTemporaryRoot("deepwrite-device-sync-")
  );
  const userDataPath = join(root, "user-data");
  const catalog = new FolderCatalogStore({ userDataPath });
  const long = new LongWorkspaceService({ userDataPath });
  const workspace = new DesktopSyncWorkspace(
    userDataPath,
    async () => catalog,
    long
  );
  return { root, userDataPath, catalog, long, workspace };
}
describe("双端同步 Core 事务与桌面真实契约", () => {
  it("接收手机短篇、剧本、长篇后可被桌面打开，往返身份一致", async () => {
    const { workspace, root } = await fixture();
    const items = syncItemSchema
      .array()
      .parse(JSON.parse(await readFile(mobileFixturePath, "utf8")));
    for (const item of items) {
      validateDesktopSyncItem(item);
      await workspace.apply(syncKey(item), null, item, root);
    }
    const result = DeviceSyncInventorySchema.parse(await workspace.list());
    expect(result.issues).toEqual([]);
    expect(result.items).toHaveLength(3);
    for (const item of items)
      expect(
        sameSyncContent(
          result.items.find((v) => syncKey(v) === syncKey(item)) ?? null,
          item
        )
      ).toBe(true);
  });
  it("保护后来写入的正文，删除移入恢复区并可重新注册", async () => {
    const { workspace, root, userDataPath, catalog } = await fixture();
    await catalog.createShortBook({ title: "事务测试", genre: "悬疑" }, root);
    const original = (await workspace.list()).items[0];
    if (!original) throw new Error("missing");
    const path = Object.keys(original.files).find((v) => v.endsWith(".md"));
    if (!path) throw new Error("missing");
    const next = {
      ...original,
      files: { ...original.files, [path]: "同步后的内容" }
    };
    await workspace.apply(syncKey(original), original, next, root);
    const registration = (await syncRegistrations(userDataPath))[0];
    if (!registration) throw new Error("missing");
    await writeFile(join(registration.root, path), "外部新编辑");
    await expect(
      workspace.apply(syncKey(original), next, original, root)
    ).rejects.toThrow("新修改");
    expect(await readFile(join(registration.root, path), "utf8")).toBe(
      "外部新编辑"
    );
    const current = (await workspace.list()).items[0];
    if (!current) throw new Error("missing");
    await workspace.apply(syncKey(current), current, null, root);
    expect((await workspace.list()).items).toHaveLength(0);
    await workspace.apply(syncKey(current), null, current, root);
    expect((await workspace.list()).items).toHaveLength(1);
  });
  it("重启发现外部新编辑时隔离原计划，保留正文并允许重新比较", async () => {
    const { workspace, root, userDataPath, catalog } = await fixture();
    await catalog.createShortBook({ title: "恢复保护", genre: "悬疑" }, root);
    const item = (await workspace.list()).items[0];
    if (!item) throw new Error("missing");
    const registration = (await syncRegistrations(userDataPath))[0];
    if (!registration) throw new Error("missing");
    const path = Object.keys(item.files).find((p) => p.endsWith(".md"));
    if (!path) throw new Error("missing");
    const next = { ...item, files: { ...item.files, [path]: "远端原计划" } };
    await writeFile(
      join(userDataPath, "device-sync-workspace-intent.json"),
      JSON.stringify({
        schemaVersion: 1,
        key: syncKey(item),
        root: registration.root,
        item: next,
        previous: item,
        removal: null
      })
    );
    await writeFile(join(registration.root, path), "中断期间的新编辑");
    await expect(workspace.recover()).rejects.toThrow("新修改");
    await expect(workspace.recover()).resolves.toBeUndefined();
    expect(await readFile(join(registration.root, path), "utf8")).toBe(
      "中断期间的新编辑"
    );
  });
  it("导出 PC 原生作品和资料库，供手机往返契约验收", async () => {
    const { workspace, root, catalog, long } = await fixture();
    await catalog.migrateSnapshot(catalogFixture());
    await catalog.createScriptBook({ title: "原生剧本", genre: "悬疑" }, root);
    await long.create(root, { title: "原生长篇", genre: "悬疑" });
    const inventory = await workspace.list();
    expect(inventory.issues).toEqual([]);
    expect(inventory.items).toHaveLength(7);
    if (process.env.DEVICE_SYNC_EXPORT_FIXTURE === "1")
      await writeFile(
        "/tmp/device-sync-desktop-fixtures.json",
        JSON.stringify(inventory.items, null, 2)
      );
  });
});
