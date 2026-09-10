import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { type SyncTransport, syncErrorMessage } from "@deepwrite/contracts";
import { SyncRemote } from "./remote";

function fixture() {
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const commit = {
    schemaVersion: 1,
    spaceId: "space_test",
    deviceId: "device_test",
    deviceName: "测试设备",
    sequence: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    items: {},
    receipts: {}
  };
  const text = JSON.stringify(commit);
  const digest = hash(text);
  const name = `000000000001-${digest}.json`;
  const root = "spaces/space_test/devices";
  const files = new Map([
    [
      `${root}/device_test/head.json`,
      JSON.stringify({ schemaVersion: 1, sequence: 1, hash: digest })
    ],
    [`${root}/device_test/commits/0000000000/${name}`, text]
  ]);
  const transport = {
    get: vi.fn(async (path: string) => files.get(path) ?? null),
    list: vi.fn(async (path: string) =>
      path === root
        ? ["device_test"]
        : path.endsWith("/commits")
          ? ["0000000000"]
          : [name]
    ),
    mkdir: vi.fn(async () => {}),
    put: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    test: vi.fn(async () => {})
  } satisfies SyncTransport;
  return {
    files,
    root,
    commit,
    transport,
    remote: new SyncRemote(transport, { hash, id: () => "test", now: () => "" })
  };
}

it("checks existing devices without creating or writing remote directories", async () => {
  const { remote, transport, commit } = fixture();
  expect(await remote.devices("space_test")).toEqual([
    expect.objectContaining({ commit })
  ]);
  expect(transport.mkdir).not.toHaveBeenCalled();
  expect(transport.put).not.toHaveBeenCalled();
});

it("allows an empty device directory before the first upload", async () => {
  const { remote, transport } = fixture();
  transport.list.mockResolvedValue([]);
  expect(await remote.devices("space_test")).toEqual([]);
  expect(transport.mkdir).not.toHaveBeenCalled();
});

it.each([false, true])(
  "preserves network errors while reading commits (fallback=%s)",
  async (fallback) => {
    const { remote, transport, files, root } = fixture();
    if (fallback) files.set(`${root}/device_test/head.json`, "malformed");
    transport.get.mockImplementation(async (path) => {
      if (path.includes("/commits/"))
        throw new Error("网盘请求过于频繁，请稍后重试。");
      return files.get(path) ?? null;
    });
    await expect(remote.devices("space_test")).rejects.toThrow(
      "网盘请求过于频繁，请稍后重试。"
    );
    expect(transport.list).toHaveBeenCalledTimes(fallback ? 3 : 1);
  }
);

it("recovers malformed head data from immutable commits", async () => {
  const { remote, files, root, commit } = fixture();
  files.set(`${root}/device_test/head.json`, "malformed");
  expect(await remote.devices("space_test")).toEqual([
    expect.objectContaining({ commit })
  ]);
});

it("rejects unverifiable commits rather than reporting an empty remote", async () => {
  const { remote, files } = fixture();
  for (const path of files.keys())
    if (path.includes("/commits/")) files.set(path, "damaged");
  await expect(remote.devices("space_test")).rejects.toThrow(
    "设备同步记录无法验证。"
  );
});

it.each([
  "网盘请求失败（409），请稍后重试。",
  "设备同步记录无法验证。",
  "网盘目录部分读取失败。"
])(
  "preserves a safe refresh failure across repeated IPC sanitization: %s",
  (message) => {
    expect(
      syncErrorMessage(new Error(syncErrorMessage(new Error(message))))
    ).toBe(message);
  }
);

it("does not expose arbitrary server responses or credentials", () => {
  const message = syncErrorMessage(
    new Error(
      "网盘请求失败（409），请稍后重试。 https://example.test/?token=invalid-test-token"
    )
  );
  expect(message).not.toMatch(/example|token|409/);
});
