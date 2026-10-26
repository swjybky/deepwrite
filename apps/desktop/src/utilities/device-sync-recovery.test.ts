import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  sameSyncContent,
  syncKey,
  SyncItemValidationError,
  type CommandEnvelope,
  type SyncItem
} from "@deepwrite/contracts";
import { decompositionFixture } from "./long-book-decomposition/test-support";
import { cleanupDecompositionRoots } from "./long-book-decomposition/fixture-cleanup.test-support";
import {
  desktopSyncInventory,
  syncRegistrations
} from "./device-sync-inventory";
import { DesktopSyncWorkspace } from "./device-sync-workspace";
import { withDeviceSyncCommands } from "./device-sync-core";
import { validateDesktopSyncItem } from "./device-sync-files";
import { DeviceSyncRecoveryPausedError } from "./device-sync-recovery";
import { commitDeviceSyncFiles } from "./device-sync-transaction";
import { ProjectTransactionConflictError } from "./project-transaction";
import {
  desktopSyncTestClient,
  desktopSyncTestPeer
} from "./device-sync.test-support";
import {
  MemoryDav,
  connect
} from "../extras/device-sync/engine/sync-test-support";

const roots: string[] = [];
afterEach(() => cleanupDecompositionRoots(roots));
async function fixture() {
  const f = await decompositionFixture("continuation", 1);
  roots.push(f.root);
  const item = (await desktopSyncInventory(f.userDataPath)).items[0]!;
  const root = (await syncRegistrations(f.userDataPath))[0]!.root;
  const workspace = new DesktopSyncWorkspace(
    f.userDataPath,
    async () => f.catalog,
    f.longs
  );
  const intentPath = join(f.userDataPath, "device-sync-workspace-intent.json");
  const handler = vi.fn(async (command: CommandEnvelope) => ({
    status: "accepted" as const,
    requestId: command.id,
    payload: await f.catalog.indexSnapshot()
  }));
  const core = withDeviceSyncCommands(
    f.userDataPath,
    async () => f.catalog,
    f.longs,
    handler
  );
  const ordinary = () =>
    core(
      CommandEnvelopeSchema.parse(
        createEnvelope("catalog.index", {}, { id: "ordinary_after_sync" })
      )
    );
  return {
    ...f,
    item,
    projectDirectory: root,
    workspace,
    intentPath,
    handler,
    core,
    ordinary
  };
}
function inconsistent(item: SyncItem) {
  const index = JSON.parse(item.files["long/index.json"]!);
  return {
    ...item,
    files: {
      ...item.files,
      "long/index.json": JSON.stringify({
        ...index,
        updatedAt: "2031-01-01T00:00:00.000Z"
      })
    }
  };
}
async function installLegacyIntent(
  f: Pick<
    Awaited<ReturnType<typeof fixture>>,
    "item" | "projectDirectory" | "intentPath"
  >,
  incoming: SyncItem,
  previous: SyncItem | null = f.item
) {
  for (const [path, content] of Object.entries(incoming.files))
    await writeFile(join(f.projectDirectory, path), content);
  const text = JSON.stringify({
    schemaVersion: 1,
    key: syncKey(f.item),
    root: f.projectDirectory,
    item: incoming,
    previous,
    removal: null
  });
  await writeFile(f.intentPath, text);
  return text;
}

it.each(["manifest", "index-file", "identity"] as const)(
  "拒绝不一致的长篇 %s，保留本地版本且不建立恢复记录",
  async (field) => {
    const f = await fixture();
    const manifest = JSON.parse(f.item.files["deepwrite.json"]!);
    if (field === "manifest") manifest.updatedAt = "2031-01-01T00:00:00.000Z";
    else if (field === "index-file")
      manifest.workspaceIndexFile.updatedAt = "2031-01-01T00:00:00.000Z";
    const index = JSON.parse(f.item.files["long/index.json"]!);
    if (field === "identity") index.bookId = "longbook_other_fixture";
    const incoming = {
      ...f.item,
      files: {
        ...f.item.files,
        "deepwrite.json": JSON.stringify(manifest),
        "long/index.json": JSON.stringify(index)
      }
    };
    await expect(
      f.workspace.apply(syncKey(f.item), f.item, incoming, f.root)
    ).rejects.toBeInstanceOf(SyncItemValidationError);
    await expect(lstat(f.intentPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(sameSyncContent((await f.workspace.list()).items[0]!, f.item)).toBe(
      true
    );
    const rejected = await f.core(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "deviceSync.workspace",
          { operation: "validate", item: incoming },
          { id: "invalid_sync" }
        )
      )
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      error: {
        code: "device_sync.validation_failed",
        details: { paths: ["deepwrite.json", "long/index.json"] }
      }
    });
  }
);

it("旧版已安装的无效计划恢复原版本并隔离，普通 Core 命令不被阻断", async () => {
  const f = await fixture();
  const text = await installLegacyIntent(f, inconsistent(f.item));
  expect((await f.ordinary()).status).toBe("accepted");
  expect(f.handler).toHaveBeenCalledOnce();
  expect(sameSyncContent((await f.workspace.list()).items[0]!, f.item)).toBe(
    true
  );
  await expect(f.longs.catalog.open(f.item.id)).resolves.toHaveProperty(
    "book.id",
    f.item.id
  );
  const paused = await readdir(join(f.userDataPath, "device-sync-paused"));
  expect(paused).toHaveLength(1);
  expect(
    await readFile(
      join(f.userDataPath, "device-sync-paused", paused[0]!),
      "utf8"
    )
  ).toBe(text);
  await expect(f.workspace.recover()).resolves.toBeUndefined();
  expect((await f.ordinary()).status).toBe("accepted");
});

it("同步服务遇到旧失败记录后释放运行状态，下一次双端同步正常完成", async () => {
  const f = await fixture();
  const dav = new MemoryDav();
  const sender = desktopSyncTestClient("sender", dav, f);
  const space = await connect(sender);
  await sender.service.sync([], true);
  const peer = await desktopSyncTestPeer(join(f.root, "receiver"), dav);
  await connect(peer.client, space);
  await peer.client.service.sync([], true);
  const item = (await desktopSyncInventory(peer.userDataPath)).items[0]!;
  const projectDirectory = (await syncRegistrations(peer.userDataPath))[0]!
    .root;
  await installLegacyIntent(
    {
      item,
      projectDirectory,
      intentPath: join(peer.userDataPath, "device-sync-workspace-intent.json")
    },
    inconsistent(item)
  );
  await expect(peer.client.service.sync()).rejects.toThrow("恢复计划已暂停");
  expect((await peer.client.service.sync()).progress.phase).toBe("complete");
  await expect(peer.longs.catalog.open(item.id)).resolves.toHaveProperty(
    "book.id",
    item.id
  );
});

it("旧恢复记录与中断期间的新编辑冲突时保留编辑和原计划，其他操作继续", async () => {
  const f = await fixture();
  const incoming = inconsistent(f.item);
  await installLegacyIntent(f, incoming);
  const index = JSON.parse(f.item.files["long/index.json"]!);
  const path = index.chapters[0].body.path;
  await writeFile(join(f.projectDirectory, path), "用户在中断之后补写的内容");
  expect((await f.ordinary()).status).toBe("accepted");
  expect(await readFile(join(f.projectDirectory, path), "utf8")).toBe(
    "用户在中断之后补写的内容"
  );
  expect((await f.workspace.list()).issues).toHaveLength(1);
  await expect(f.workspace.recover()).resolves.toBeUndefined();
});

it.each([
  "{malformed",
  JSON.stringify({ schemaVersion: 1, root: "relative-path" })
])("损坏恢复记录只隔离一次并保留原始字节：%s", async (text) => {
  const f = await fixture();
  await writeFile(f.intentPath, text);
  await expect(f.workspace.recover()).rejects.toBeInstanceOf(
    DeviceSyncRecoveryPausedError
  );
  await expect(f.workspace.recover()).resolves.toBeUndefined();
  expect((await f.ordinary()).status).toBe("accepted");
  const [paused] = await readdir(join(f.userDataPath, "device-sync-paused"));
  expect(
    await readFile(join(f.userDataPath, "device-sync-paused", paused!), "utf8")
  ).toBe(text);
});

it("恢复计划未能持久隔离时仍报告失败，保留原计划并不执行后续命令", async () => {
  const f = await fixture();
  const text = "{malformed";
  await writeFile(f.intentPath, text);
  await writeFile(join(f.userDataPath, "device-sync-paused"), "occupied");
  expect((await f.ordinary()).status).toBe("rejected");
  expect(f.handler).not.toHaveBeenCalled();
  expect(await readFile(f.intentPath, "utf8")).toBe(text);
});

it("文件数量超限在建立计划之前拒绝，旧版超限计划隔离后可继续工作", async () => {
  const f = await fixture();
  const files = { ...f.item.files };
  for (let i = 0; i < 20_000; i++) files[`retained/file_${i}.md`] = "合成残留";
  const incoming = { ...f.item, files };
  expect(() => validateDesktopSyncItem(incoming)).toThrow(
    SyncItemValidationError
  );
  await expect(
    f.workspace.apply(syncKey(f.item), f.item, incoming, f.root)
  ).rejects.toThrow("同步上限");
  await expect(lstat(f.intentPath)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(
    f.intentPath,
    JSON.stringify({
      schemaVersion: 1,
      key: syncKey(f.item),
      root: f.projectDirectory,
      item: incoming,
      previous: f.item,
      removal: null
    })
  );
  expect((await f.ordinary()).status).toBe("accepted");
  expect(sameSyncContent((await f.workspace.list()).items[0]!, f.item)).toBe(
    true
  );
});

it("未被同步修改的文件发生外部编辑时仍拒绝事务，保留新编辑和其他原文件", async () => {
  const f = await fixture();
  const chapter = JSON.parse(f.item.files["long/index.json"]!).chapters[0];
  const incoming = {
    ...f.item,
    files: { ...f.item.files, [chapter.card.path]: "远端新章卡" }
  };
  await writeFile(
    join(f.projectDirectory, chapter.body.path),
    "用户在快照读取后的新编辑"
  );
  await expect(
    commitDeviceSyncFiles(f.projectDirectory, f.item.files, incoming)
  ).rejects.toBeInstanceOf(ProjectTransactionConflictError);
  expect(
    await readFile(join(f.projectDirectory, chapter.body.path), "utf8")
  ).toBe("用户在快照读取后的新编辑");
  expect(
    await readFile(join(f.projectDirectory, chapter.card.path), "utf8")
  ).toBe(f.item.files[chapter.card.path]);
});
