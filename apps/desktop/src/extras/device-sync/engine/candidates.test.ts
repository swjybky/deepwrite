import { expect, it } from "vitest";
import type { SyncRevision } from "@deepwrite/contracts";
import { readSyncCandidates } from "./candidates";
import { SyncRemote } from "./remote";
import { MemoryDav } from "./sync-test-support";
import { WebDavError } from "../webdav-errors";

function fixture() {
  const dav = new MemoryDav();
  const controller = new AbortController();
  const remote = new SyncRemote(
    dav,
    { hash: () => "a".repeat(64), id: () => "fixture", now: () => "" },
    controller.signal
  );
  const revision: SyncRevision = {
    kind: "book",
    id: "book_fixture",
    title: "合成作品",
    clock: { source: 1 },
    files: { "deepwrite.json": { hash: "a".repeat(64), pack: "b".repeat(64) } }
  };
  const entries = [{ deviceId: "source", deviceName: "来源", revision }];
  return {
    dav,
    controller,
    read: () =>
      readSyncCandidates(
        remote,
        entries,
        "space_fixture",
        "book:book_fixture",
        controller.signal
      )
  };
}

it("内容包缺失仍明确报告完整性校验失败", async () => {
  const f = fixture();
  expect((await f.read()).issues[0]?.messageText?.code).toBe("remoteInvalid");
});

it("网络异常保留安全原因，不误报为作品损坏", async () => {
  const f = fixture();
  f.dav.get = async () => {
    throw new WebDavError("连接网盘超时，请重试。");
  };
  expect((await f.read()).issues[0]?.messageText).toEqual({
    code: "remoteReadFailed",
    params: { reason: "连接网盘超时，请重试。" }
  });
});

it("不把服务器响应、地址或凭据带入错误提示", async () => {
  const f = fixture();
  f.dav.get = async () => {
    throw new Error(
      "synthetic failure https://example.test/?token=invalid-placeholder"
    );
  };
  expect(JSON.stringify((await f.read()).issues)).not.toMatch(
    /example\.test|token=|invalid-placeholder/
  );
});

it("取消直接结束读取，不生成损坏或网络故障项", async () => {
  const f = fixture();
  f.controller.abort();
  await expect(f.read()).rejects.toThrow("同步已取消");
});
