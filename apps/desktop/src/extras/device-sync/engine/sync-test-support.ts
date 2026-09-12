import { DeviceSyncService } from "./service";
import {
  sameSyncContent,
  syncKey,
  type SyncItem,
  type SyncMetadata,
  type SyncTransport,
  type SyncServiceOptions
} from "@deepwrite/contracts";
import { createHash } from "node:crypto";

export function item(
  body = "第一行\n第二行\n第三行\n",
  id = "book_example"
): SyncItem {
  return {
    id,
    kind: "book",
    title: "测试作品",
    files: {
      "deepwrite.json": '{"schemaVersion":4,"id":"book_example"}',
      "draft.md": body
    }
  };
}
export class MemoryDav implements SyncTransport {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  puts: string[] = [];
  beforePut: ((path: string, value: string) => Promise<void>) | null = null;
  async get(path: string) {
    return this.files.get(path) ?? null;
  }
  async put(path: string, value: string) {
    await this.beforePut?.(path, value);
    this.puts.push(path);
    this.files.set(path, value);
  }
  async mkdir(path: string) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++)
      this.folders.add(parts.slice(0, i).join("/"));
  }
  async list(path: string) {
    const prefix = `${path}/`;
    return [
      ...new Set(
        [...this.files.keys(), ...this.folders]
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length).split("/")[0] ?? "")
          .filter(Boolean)
      )
    ];
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async test() {}
}
export function device(name: string, dav: MemoryDav, initial: SyncItem[] = []) {
  let metadata: SyncMetadata | null = null;
  let secret: string | null = null;
  let counter = 0;
  const workspace = new Map(initial.map((value) => [syncKey(value), value]));
  const options: SyncServiceOptions = {
    runtime: {
      hash: (value) => createHash("sha256").update(value).digest("hex"),
      id: () => `${name}_${++counter}`,
      now: () => "2026-09-08T01:00:00.000Z"
    },
    metadata: {
      read: async () => (metadata ? structuredClone(metadata) : null),
      write: async (value) => {
        metadata = structuredClone(value);
      }
    },
    credentials: {
      get: async () => secret,
      set: async (value) => {
        secret = value;
      },
      delete: async () => {
        secret = null;
      }
    },
    workspace: {
      list: async () => ({ items: [...workspace.values()], issues: [] }),
      validate: async () => {},
      recover: async () => {},
      apply: async (key, expected, next) => {
        if (!sameSyncContent(expected, workspace.get(key) ?? null))
          throw new Error("stale");
        if (next) workspace.set(key, structuredClone(next));
        else workspace.delete(key);
      }
    },
    transport: () => dav
  };
  const service = new DeviceSyncService(options);
  return { service, workspace, options, metadata: () => metadata };
}
export async function connect(
  client: ReturnType<typeof device>,
  space: string | null = null
) {
  await client.service.connect(
    {
      schemaVersion: 1,
      provider: "webdav",
      endpoint: "https://example.test/dav",
      username: "test-user",
      directory: "DeepWriteSync",
      deviceName: "测试设备",
      spaceId: space,
      excludedKeys: []
    },
    "invalid-test-password"
  );
  const status = await client.service.join(space);
  return status.config?.spaceId ?? "";
}
