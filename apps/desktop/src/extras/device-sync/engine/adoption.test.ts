import { test, expect } from "vitest";
import {
  dispatchSyncRequest,
  syncRequestSchema,
  type SyncAdoptionSide
} from "@deepwrite/contracts";
import { MemoryDav, connect, device, item } from "./sync-test-support";

const key = "book:book_example";
const otherKey = "book:book_other";

async function pair() {
  const dav = new MemoryDav();
  const pc = device("pc", dav, [item(), item("另一篇原文", "book_other")]);
  const phone = device("phone", dav);
  const space = await connect(pc);
  await pc.service.sync([], true);
  await connect(phone, space);
  await phone.service.sync([], true);
  return { dav, pc, phone, space };
}

async function adopt(
  client: ReturnType<typeof device>,
  side: SyncAdoptionSide,
  keys = [key]
) {
  const response = await dispatchSyncRequest(client.service, {
    operation: "sync",
    adoption: { side, keys }
  });
  if (response.kind !== "status") throw new Error("Expected sync status");
  return response.status;
}

test.each(["remote", "local"] as const)(
  "批量采用 %s 完整版本后，双端冲突消失且再次同步不复发",
  async (side) => {
    const { pc, phone } = await pair();
    for (const id of ["book_example", "book_other"]) {
      pc.workspace.set(`book:${id}`, {
        ...item("电脑正文", id),
        files: { ...item("电脑正文", id).files, "notes.md": "电脑独有设定" }
      });
      phone.workspace.set(`book:${id}`, {
        ...item("手机正文", id),
        files: { ...item("手机正文", id).files, "notes.md": "手机独有设定" }
      });
    }
    await pc.service.sync();
    expect((await phone.service.sync()).issues).toHaveLength(2);
    const chosen = new Map(side === "remote" ? pc.workspace : phone.workspace);
    const result = await adopt(phone, side, [key, otherKey]);
    expect(result.issues).toEqual([]);
    expect(result.progress).toMatchObject({
      phase: "complete",
      completed: 2,
      total: 2
    });
    expect(result.progress.title).toBe(
      side === "remote"
        ? "已上传 0 项，已下载 2 项"
        : "已上传 2 项，已下载 0 项"
    );
    await pc.service.sync();
    await phone.service.sync();
    for (const id of [key, otherKey]) {
      expect(phone.workspace.get(id)).toEqual(chosen.get(id));
      expect(pc.workspace.get(id)).toEqual(chosen.get(id));
    }
    if (side === "remote") {
      const previous = phone
        .metadata()
        ?.history.find(
          (entry) => entry.key === key && entry.description === "同步前的版本"
        );
      expect(previous?.item?.files["draft.md"]).toBe("手机正文");
    }
    expect(
      (await phone.service.status()).items.every(
        (entry) => !entry.dirty && !entry.remoteDirty
      )
    ).toBe(true);
  }
);

test.each(["remote", "local"] as const)(
  "尚未产生冲突预览时也可采用 %s，不自动混合双方独立编辑",
  async (side) => {
    const { pc, phone } = await pair();
    const remote = item("电脑\n第二行\n第三行\n");
    const local = item("第一行\n第二行\n手机\n");
    pc.workspace.set(key, remote);
    phone.workspace.set(key, local);
    await pc.service.sync();
    const checked = await phone.service.check();
    expect(checked.issues).toEqual([]);
    expect(checked.items.find((entry) => entry.key === key)).toMatchObject({
      dirty: true,
      remoteDirty: true
    });
    expect((await adopt(phone, side)).issues).toEqual([]);
    expect(phone.workspace.get(key)).toEqual(
      side === "remote" ? remote : local
    );
  }
);

test("单项采用不修改另一项的正文、基线或未完成状态", async () => {
  const { pc, phone } = await pair();
  for (const id of ["book_example", "book_other"]) {
    pc.workspace.set(`book:${id}`, item("电脑正文", id));
    phone.workspace.set(`book:${id}`, item("手机正文", id));
  }
  await pc.service.sync();
  await phone.service.sync();
  const baseline = phone.metadata()?.baselines[otherKey];
  const result = await adopt(phone, "remote");
  expect(result.issues.map((issue) => issue.key)).toEqual([otherKey]);
  expect(result.progress.completed).toBe(1);
  expect(phone.metadata()?.baselines[otherKey]).toEqual(baseline);
  expect(phone.workspace.get(otherKey)?.files["draft.md"]).toBe("手机正文");
  await pc.service.sync();
  expect(pc.workspace.get(otherKey)?.files["draft.md"]).toBe("电脑正文");
});

test("单向同步产生无 token 的未完成项后，可以直接采用版本", async () => {
  const { pc, phone } = await pair();
  pc.workspace.set(key, item("电脑\n第二行\n第三行\n"));
  phone.workspace.set(key, item("第一行\n第二行\n手机\n"));
  await pc.service.sync();
  expect(
    (await phone.service.sync([], false, "download")).issues[0]
  ).toMatchObject({ token: "", reason: "conflict" });
  expect((await adopt(phone, "remote")).issues).toEqual([]);
  expect(phone.workspace.get(key)).toEqual(pc.workspace.get(key));
});

test.each(["remote", "local"] as const)(
  "远端删除后采用 %s，分别删除或恢复，且保留历史",
  async (side) => {
    const { pc, phone } = await pair();
    pc.workspace.delete(key);
    await pc.service.sync();
    expect((await phone.service.sync()).issues[0]?.reason).toBe("delete");
    expect((await adopt(phone, side)).issues).toEqual([]);
    await pc.service.sync();
    expect(phone.workspace.has(key)).toBe(side === "local");
    expect(pc.workspace.has(key)).toBe(side === "local");
    if (side === "remote") {
      const recovery = phone
        .metadata()
        ?.history.find(
          (entry) => entry.key === key && entry.description === "同步前的版本"
        );
      expect(recovery?.item).toEqual(item());
    }
  }
);

test("选版本会重新读取最新内容；传输期间继续编辑仍触发写入冲突保护", async () => {
  const { pc, phone } = await pair();
  pc.workspace.set(key, item("电脑预览版本"));
  phone.workspace.set(key, item("手机正文"));
  await pc.service.sync();
  await phone.service.sync();
  pc.workspace.set(key, item("电脑随后上传的新版本"));
  await pc.service.sync();
  expect((await adopt(phone, "remote")).issues).toEqual([]);
  expect(phone.workspace.get(key)?.files["draft.md"]).toBe(
    "电脑随后上传的新版本"
  );

  pc.workspace.set(key, item("电脑再修改"));
  await pc.service.sync();
  const apply = phone.options.workspace.apply;
  phone.options.workspace.apply = async (...args) => {
    phone.workspace.set(key, item("传输期间继续编辑"));
    return apply(...args);
  };
  const baseline = phone.metadata()?.baselines[key];
  const result = await adopt(phone, "remote");
  expect(result.issues[0]?.reason).toBe("failed");
  expect(phone.workspace.get(key)?.files["draft.md"]).toBe("传输期间继续编辑");
  expect(phone.metadata()?.baselines[key]).toEqual(baseline);
});

test("不将不存在的本机版本当作删除，暂停项也不被批量选择覆盖", async () => {
  const { pc, phone } = await pair();
  const newKey = "book:remote_only";
  pc.workspace.set(newKey, item("远端独有作品", "remote_only"));
  await pc.service.sync();
  const result = await adopt(phone, "local", [newKey]);
  expect(result.issues[0]?.message).toContain("本机没有可采用的版本");
  expect(phone.metadata()?.baselines[newKey]).toBeUndefined();
  await pc.service.sync();
  expect(pc.workspace.has(newKey)).toBe(true);
  const config = result.config;
  if (!config) throw new Error("Missing sync config");
  await phone.service.configure({ ...config, excludedKeys: [newKey] });
  await adopt(phone, "remote", [newKey]);
  expect(phone.workspace.has(newKey)).toBe(false);
});

test("远端内容损坏不能通过采用按钮绕过完整性检查", async () => {
  const { dav, pc, phone } = await pair();
  pc.workspace.set(key, item("电脑新正文"));
  phone.workspace.set(key, item("手机新正文"));
  await pc.service.sync();
  const baseline = phone.metadata()?.baselines[key];
  const revision = pc.metadata()?.published?.items[key];
  const pack = revision?.files?.["draft.md"]?.pack;
  const path = [...dav.files.keys()].find(
    (entry) => pack && entry.endsWith(`/${pack}.json`)
  );
  if (!path) throw new Error("Missing test pack");
  dav.files.set(path, "{broken");
  expect((await adopt(phone, "remote")).issues[0]?.reason).toBe("failed");
  expect(phone.workspace.get(key)?.files["draft.md"]).toBe("手机新正文");
  expect(phone.metadata()?.baselines[key]).toEqual(baseline);
});

test("多台远端并行版本不按顺序覆盖，仍能明确采用本地收敛", async () => {
  const { dav, pc, phone, space } = await pair();
  const laptop = device("laptop", dav);
  await connect(laptop, space);
  await laptop.service.sync([], true);
  pc.workspace.set(key, item("电脑版本"));
  laptop.workspace.set(key, item("笔记本版本"));
  await Promise.all([pc.service.sync(), laptop.service.sync()]);
  const result = await adopt(phone, "remote");
  expect(result.issues[0]?.message).toContain("多台远端设备");
  expect(phone.workspace.get(key)).toEqual(item());
  expect((await adopt(phone, "local")).issues).toEqual([]);
  await pc.service.sync();
  await laptop.service.sync();
  expect(pc.workspace.get(key)).toEqual(item());
  expect(laptop.workspace.get(key)).toEqual(item());
});

test("版本选择请求拒绝空目标和未知方向", () => {
  expect(
    syncRequestSchema.safeParse({
      operation: "sync",
      adoption: { side: "remote", keys: [] }
    }).success
  ).toBe(false);
  expect(
    syncRequestSchema.safeParse({
      operation: "sync",
      adoption: { side: "both", keys: [key] }
    }).success
  ).toBe(false);
});
