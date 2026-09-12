import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { build } from "vite";
import { ConversationStorageWorker } from "./worker-client";

let directory: string;
const clients: ConversationStorageWorker[] = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "deepwrite-storage-worker-test-"));
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: join(dirname(fileURLToPath(import.meta.url)), "worker-entry.ts"),
      outDir: directory,
      emptyOutDir: false,
      rollupOptions: { output: { entryFileNames: "worker.mjs" } }
    },
    ssr: { noExternal: true }
  });
});
afterEach(async () => {
  await Promise.all(
    clients.splice(0).map((client) => client.close().catch(() => {}))
  );
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
function client(name: string, legacyStatePath?: string) {
  const worker = new ConversationStorageWorker(
    join(directory, `${name}.sqlite`),
    join(directory, "worker.mjs"),
    legacyStatePath
  );
  clients.push(worker);
  return worker;
}

describe("Core-owned conversation worker", () => {
  it("waits for legacy migration, preserves the source, commits incrementally and recovers after restart", async () => {
    vi.stubEnv("DEEPWRITE_MAIN_INSTANCE_ID", "fixture-worker-main");
    const source = join(directory, "legacy.json");
    await writeFile(
      source,
      JSON.stringify({
        version: 1,
        entries: {
          "conversation-history:fixture": {
            version: 1,
            activeSessionId: "session",
            conversations: [
              {
                sessionId: "session",
                messages: [{ id: "message", role: "user", content: "原始内容" }]
              }
            ]
          }
        }
      })
    );
    const first = client("migrated", source);
    const query = { key: "conversation-history:fixture", sessionId: "session" };
    expect((await first.messages(query)).messages[0]?.value.content).toBe(
      "原始内容"
    );
    const batch = {
      ...query,
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      batchId: "append",
      operations: [
        {
          type: "patchMessage" as const,
          messageId: "message",
          changes: [{ op: "append" as const, path: ["content"], text: "追加" }]
        }
      ]
    };
    const receipt = await first.commit(batch);
    await first.close();
    const second = client("migrated", source);
    expect(await second.commit(batch)).toEqual(receipt);
    expect((await second.messages(query)).messages[0]?.value.content).toBe(
      "原始内容追加"
    );
    await second.legacySave("conversation-preferences:fixture", {
      modelId: "fixture-model"
    });
    expect(await second.legacyLoad("conversation-preferences:fixture")).toEqual(
      { modelId: "fixture-model" }
    );
    await expect(second.legacySave(query.key, {})).rejects.toThrow(
      "incremental"
    );
    const merged = await second.mergeScopes({
      key: "conversation-history:canonical",
      sources: [query.key]
    });
    expect(merged.mergedSources).toEqual([query.key]);
    expect(
      (
        await second.messages({
          ...query,
          key: "conversation-history:canonical"
        })
      ).messages[0]?.value.content
    ).toBe("原始内容追加");
    expect((await second.list({ key: query.key })).sessions).toEqual([]);
  });

  it("bounds simultaneous requests, retains explicit backpressure and permits later requests", async () => {
    const worker = client("bounded");
    const requests = Array.from({ length: 64 }, () =>
      worker.list({ key: "conversation-history:fixture" })
    );
    const results = await Promise.allSettled(requests);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(32);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(32);
    expect(
      rejected.every(
        (result) =>
          result.status === "rejected" && result.reason.code === "queue_full"
      )
    ).toBe(true);
    expect(
      (await worker.list({ key: "conversation-history:fixture" })).sessions
    ).toEqual([]);
  });
});
