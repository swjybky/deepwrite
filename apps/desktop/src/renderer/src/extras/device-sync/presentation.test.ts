import { expect, test } from "vitest";
import type { SyncStatus } from "@deepwrite/contracts/renderer";
import { syncPresentation } from "./presentation";

test("bulk adoption targets unfinished items once, excluding paused and ordinary one-way changes", () => {
  const status: SyncStatus = {
    config: {
      schemaVersion: 1,
      provider: "webdav",
      endpoint: "https://example.test/dav",
      username: "invalid-test-user",
      directory: "DeepWriteSync",
      spaceId: "test-space",
      deviceName: "测试设备",
      excludedKeys: ["book:paused"]
    },
    credentialSaved: false,
    deviceId: "pc",
    firstSyncConfirmed: true,
    lastCheckedAt: null,
    lastSuccessAt: null,
    progress: { phase: "idle", total: 0, completed: 0, title: "" },
    devices: [],
    history: [],
    items: [
      {
        key: "book:both",
        title: "双方修改",
        kind: "book",
        included: true,
        dirty: true,
        remoteDirty: true
      },
      {
        key: "book:upload",
        title: "本机修改",
        kind: "book",
        included: true,
        dirty: true,
        remoteDirty: false
      },
      {
        key: "book:download",
        title: "远端更新",
        kind: "book",
        included: true,
        dirty: false,
        remoteDirty: true
      },
      {
        key: "book:paused",
        title: "暂停同步",
        kind: "book",
        included: false,
        dirty: true,
        remoteDirty: true
      }
    ],
    issues: ["book:both", "book:failed", "book:paused"].map((key) => ({
      key,
      title: "未完成作品",
      token: "",
      reason: "conflict",
      message: "请选择版本",
      paths: [],
      local: null,
      versions: []
    }))
  };
  expect(syncPresentation(status).adoptionKeys).toEqual([
    "book:both",
    "book:failed"
  ]);
});
