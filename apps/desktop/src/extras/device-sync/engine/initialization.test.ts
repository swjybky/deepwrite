import { test, expect } from "vitest";
import {
  SyncItemValidationError,
  syncErrorMessage,
  stableSyncJson,
  syncKey
} from "@deepwrite/contracts";
import {
  connect,
  device as baseDevice,
  item,
  MemoryDav
} from "./sync-test-support";
function device(...args: Parameters<typeof baseDevice>) {
  const client = baseDevice(...args);
  const fingerprint = () =>
    client.options.runtime.hash(stableSyncJson([...client.workspace]));
  client.options.workspace.initialization = {
    inspect: async () => ({
      fingerprint: fingerprint(),
      itemCount: client.workspace.size
    }),
    replace: async (items, metadata, expected, signal) => {
      if (signal.aborted) throw new Error("同步已取消。");
      if (fingerprint() !== expected)
        throw new Error("本机数据已变化，请重新下载预览后确认。");
      client.workspace.clear();
      for (const item of items)
        client.workspace.set(syncKey(item), structuredClone(item));
      await client.options.metadata.write(metadata);
    }
  };
  return client;
}

async function setup() {
  const dav = new MemoryDav();
  const pc = device("pc", dav, [
    item("电脑正文"),
    item("电脑第二篇", "book_second")
  ]);
  const phone = device("phone", dav, [
    item("手机未上传的改写"),
    item("手机独有作品", "book_phone_only")
  ]);
  const space = await connect(pc);
  await pc.service.sync([], true);
  await connect(phone, space);
  const source = pc.metadata()?.deviceId ?? "";
  return { dav, pc, phone, source, space };
}

test("预览只下载；确认后清除本地独有项并重建基线，不上传删除远端", async () => {
  const { dav, pc, phone, source } = await setup();
  const before = [...phone.workspace];
  const metadata = phone.metadata();
  const remote = [...dav.files];
  const preview = await phone.service.previewInitialization(source);
  expect(preview).toMatchObject({
    itemCount: 2,
    localItemCount: 2,
    fileCount: 4,
    deviceId: source
  });
  expect([...phone.workspace]).toEqual(before);
  expect(phone.metadata()).toEqual(metadata);
  const result = await phone.service.initializeFromRemote(preview.token);
  expect([...phone.workspace]).toEqual([...pc.workspace]);
  expect([...dav.files]).toEqual(remote);
  expect(result.firstSyncConfirmed).toBe(true);
  expect(
    result.items.every((entry) => !entry.dirty && !entry.remoteDirty)
  ).toBe(true);
  expect(result.issues).toEqual([]);
  expect(result.history).toEqual([]);
  expect(result.progress.phase).toBe("complete");
  expect(result.config).toEqual({ ...metadata?.config, excludedKeys: [] });
  const repeated = await phone.service.sync();
  expect(repeated.progress.completed).toBe(0);
  expect(
    phone.metadata()?.published?.items["book:book_phone_only"]
  ).toBeUndefined();
  phone.workspace.set("book:book_example", item("初始化后修改"));
  expect(
    (await phone.service.status()).items
      .filter((entry) => entry.dirty)
      .map((entry) => entry.key)
  ).toEqual(["book:book_example"]);
});

test("本地损坏项不影响初始化，仍须全量验证远端", async () => {
  const { phone, source } = await setup();
  phone.options.workspace.list = async () => ({
    items: [],
    issues: [{ key: "book:broken", title: "损坏项", message: "本机结构无效" }]
  });
  const preview = await phone.service.previewInitialization(source);
  expect(preview.itemCount).toBe(2);
  phone.options.workspace.validate = async () => {
    throw new Error("private implementation detail");
  };
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "远端作品不完整"
  );
});

test("远端空空间或选到本机不会清除本地", async () => {
  const { phone } = await setup();
  await expect(
    phone.service.previewInitialization(phone.metadata()?.deviceId ?? "")
  ).rejects.toThrow("选择另一台");
  expect(phone.workspace.size).toBe(2);
  const dav = new MemoryDav();
  const empty = device("empty", dav);
  const local = device("local", dav, [item()]);
  const space = await connect(empty);
  await empty.service.sync([], true);
  await connect(local, space);
  await expect(
    local.service.previewInitialization(empty.metadata()?.deviceId ?? "")
  ).rejects.toThrow("没有可下载");
  expect(local.workspace.size).toBe(1);
});

test("任何远端文件缺失或结构校验失败，整次初始化拒绝且本地不变", async () => {
  const { dav, phone, source } = await setup();
  const before = [...phone.workspace];
  const object = [...dav.files.keys()].find((path) =>
    path.includes("/objects/")
  );
  if (!object) throw new Error("missing fixture");
  dav.files.delete(object);
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "远端作品不完整"
  );
  expect([...phone.workspace]).toEqual(before);
  await expect(
    phone.service.initializeFromRemote("invalid_preview")
  ).rejects.toThrow("预览已过期");
});

test("远端有未被来源电脑合并的修改时拒绝初始化", async () => {
  const { dav, pc, phone, source, space } = await setup();
  const third = device("third", dav);
  await connect(third, space);
  await third.service.sync([], true);
  third.workspace.set("book:book_example", item("另一端的修改"));
  await third.service.sync();
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "未合并"
  );
  await pc.service.sync();
  expect((await phone.service.previewInitialization(source)).itemCount).toBe(2);
});

test("预览后远端或本机改变，必须重新预览；过期和重复令牌拒绝", async () => {
  const { phone, pc, source } = await setup();
  const first = await phone.service.previewInitialization(source);
  pc.workspace.set("book:book_example", item("电脑新版本"));
  await pc.service.sync();
  await expect(phone.service.initializeFromRemote(first.token)).rejects.toThrow(
    "远端数据已更新"
  );
  const second = await phone.service.previewInitialization(source);
  phone.workspace.set("book:book_example", item("预览后的手机编辑"));
  await expect(
    phone.service.initializeFromRemote(second.token)
  ).rejects.toThrow("本机数据已变化");
  expect(phone.workspace.get("book:book_example")?.files["draft.md"]).toBe(
    "预览后的手机编辑"
  );
  const third = await phone.service.previewInitialization(source);
  phone.options.runtime.now = () => "2026-09-08T02:00:00.000Z";
  await expect(phone.service.initializeFromRemote(third.token)).rejects.toThrow(
    "预览已过期"
  );
});

test("下载中取消不生成可确认的预览，不修改本地", async () => {
  const { dav, phone, source } = await setup();
  const get = dav.get.bind(dav);
  dav.get = async (path) => {
    if (path.includes("/objects/")) phone.service.cancel();
    return get(path);
  };
  const before = [...phone.workspace];
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "同步已取消"
  );
  expect([...phone.workspace]).toEqual(before);
  expect((await phone.service.status()).progress.phase).toBe("cancelled");
});

test("初始化错误可诊断但不回显底层私密请求", () => {
  expect(
    syncErrorMessage(new Error("远端数据已更新，请重新下载预览后确认。"))
  ).toContain("远端数据已更新");
  expect(
    syncErrorMessage(
      new Error("https://user:invalid-password@example.test/private")
    )
  ).not.toContain("invalid-password");
});

test("本机旧提交不阻塞初始化，第三设备未合并提交给出设备名并支持忽略继续，且保留后续三方合并", async () => {
  const dav = new MemoryDav();
  const pc = device("pc", dav, [
    item("第一行\n第二行\n第三行\n"),
    item("电脑第二篇", "book_second")
  ]);
  const phone = device("phone", dav, [item("第一行\n第二行\n第三行\n")]);
  const space = await connect(pc);
  await pc.service.sync([], true);
  await connect(phone, space);
  await phone.service.sync([], true);

  phone.workspace.set(
    "book:book_example",
    item("手机冲突行\n第二行\n第三行\n")
  );
  await phone.service.sync();

  const source = pc.metadata()?.deviceId ?? "";
  const selfPreview = await phone.service.previewInitialization(source);
  expect(selfPreview.itemCount).toBe(2);
  await phone.service.initializeFromRemote(selfPreview.token);
  expect(
    (await phone.service.status()).items.some(
      (entry) => entry.dirty || entry.remoteDirty
    )
  ).toBe(false);
  expect((await phone.service.sync()).issues).toEqual([]);

  const third = device("third", dav);
  await third.service.connect(
    {
      schemaVersion: 1,
      provider: "webdav",
      endpoint: "https://example.test/dav",
      username: "test-user",
      directory: "DeepWriteSync",
      deviceName: "旧平板",
      spaceId: space,
      excludedKeys: []
    },
    "invalid-test-password"
  );
  await third.service.join(space);
  await third.service.sync([], true);
  third.workspace.set("book:book_example", item("第三设备改写"));
  await third.service.sync();

  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    /远端设备（旧平板）还有未合并的版本/
  );
  const ignoredPreview = await phone.service.previewInitialization(source, {
    ignoreOtherDevices: true
  });
  expect(ignoredPreview.ignoredDevices).toEqual(["旧平板"]);
  await phone.service.initializeFromRemote(ignoredPreview.token);

  pc.workspace.set("book:book_example", item("电脑新首行\n第二行\n第三行\n"));
  phone.workspace.set(
    "book:book_example",
    item("第一行\n第二行\n手机新末行\n")
  );
  expect((await phone.service.sync()).issues).toEqual([]);
  expect((await pc.service.sync()).issues).toEqual([]);
  const synced = await phone.service.sync();
  expect(synced.issues).toEqual([]);
  expect(phone.workspace.get("book:book_example")?.files["draft.md"]).toBe(
    "电脑新首行\n第二行\n手机新末行\n"
  );
  expect(pc.workspace.get("book:book_example")?.files["draft.md"]).toBe(
    "电脑新首行\n第二行\n手机新末行\n"
  );
});

test("初始化预览区分网络错误、单作品校验错误并统计跳过的不支持作品", async () => {
  const { dav, pc, phone, source } = await setup();
  pc.workspace.set("book:book_unsupported", {
    ...item("不支持的学术作品", "book_unsupported")
  });
  await pc.service.sync();
  phone.options.workspace.supportsItem = (entry) =>
    entry.id !== "book_unsupported";
  const supportedPreview = await phone.service.previewInitialization(source);
  expect(supportedPreview).toMatchObject({
    itemCount: 2,
    skippedUnsupportedCount: 1
  });

  const originalGet = dav.get.bind(dav);
  dav.get = async (path) => {
    if (path.includes("/objects/")) throw new Error("连接网盘超时，请重试。");
    return originalGet(path);
  };
  await expect(phone.service.previewInitialization(source)).rejects.toThrow(
    "连接网盘超时，请重试。"
  );

  dav.get = originalGet;
  phone.options.workspace.validate = async () => {
    throw new SyncItemValidationError(
      ["draft.md"],
      "作品缺少索引引用的文件，请在来源设备更新应用并重新上传。"
    );
  };
  let message = "";
  try {
    await phone.service.previewInitialization(source);
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  expect(message).toContain("远端作品不完整或不兼容（测试作品）");
  expect(syncErrorMessage(new Error(message))).toBe(message);
});
