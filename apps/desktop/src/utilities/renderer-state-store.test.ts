import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RendererStateSerializationError } from "./renderer-state-store";
import {
  TestRendererStateStore as RendererStateStore,
  closeRendererStateTestStores
} from "./renderer-state-store.test-support";

const roots: string[] = [];
afterEach(async () => {
  await closeRendererStateTestStores();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-renderer-state-"));
  roots.push(root);
  return { root, store: new RendererStateStore(root) };
}

describe("RendererStateStore", () => {
  it("persists preferences and compatible history records and reloads them from SQLite", async () => {
    const { root, store } = await createStore();
    const key = "conversation-history:book%3Aplaceholder";
    const value = {
      version: 1,
      messages: [{ role: "user", content: "虚构测试内容" }]
    };
    await expect(store.load(key)).resolves.toBeUndefined();
    await store.save(key, value);
    await store.save("conversation-preferences:options", { temperature: 0.7 });
    expect((await readFile(store.statePath)).subarray(0, 16).toString()).toBe(
      "SQLite format 3\u0000"
    );
    expect(store.statePath).toBe(
      join(root, "renderer-state", "conversations.sqlite")
    );
    await expect(new RendererStateStore(root).load(key)).resolves.toEqual(
      value
    );
    expect(await store.listHistoryKeys()).toEqual([key]);
  });

  it("serializes concurrent writes without replacing unrelated keys", async () => {
    const { root, store } = await createStore();
    const key = "conversation-history:book-one";
    await Promise.all([
      store.save(key, { revision: 1 }),
      store.save("conversation-preferences:run-options:v1", { revision: 2 }),
      store.save(key, { revision: 3 })
    ]);
    await expect(new RendererStateStore(root).load(key)).resolves.toEqual({
      revision: 3
    });
    await expect(
      store.load("conversation-preferences:run-options:v1")
    ).resolves.toEqual({ revision: 2 });
  });

  it("removes one key without disturbing other state", async () => {
    const { root, store } = await createStore();
    await store.save("conversation-history:removed", { value: "removed" });
    await store.save("conversation-history:retained", { value: "retained" });
    await store.remove("conversation-history:removed");
    await store.remove("conversation-history:missing");
    await expect(
      store.load("conversation-history:removed")
    ).resolves.toBeUndefined();
    await expect(
      new RendererStateStore(root).load("conversation-history:retained")
    ).resolves.toEqual({ value: "retained" });
  });

  it("rejects invalid keys and lossy JSON values without discarding valid data", async () => {
    const { store } = await createStore();
    await expect(store.save("unscoped:key", { ok: true })).rejects.toThrow();
    for (const value of [
      undefined,
      { number: Number.NaN },
      new Map(),
      [undefined]
    ]) {
      await expect(
        store.save("conversation-history:invalid", value)
      ).rejects.toBeInstanceOf(RendererStateSerializationError);
    }
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(
      store.save("conversation-history:invalid", circular)
    ).rejects.toBeInstanceOf(RendererStateSerializationError);
    await store.save("conversation-history:valid", {
      ok: true,
      proposedText: undefined
    });
    await expect(store.load("conversation-history:valid")).resolves.toEqual({
      ok: true
    });
  });

  it("allows a compatibility record larger than the retired 64 MiB limit and remains writable", async () => {
    const { root, store } = await createStore();
    const content = "x".repeat(65 * 1024 * 1024);
    await store.save("conversation-history:large", { content });
    await store.save("conversation-history:new", { content: "新消息" });
    const reloaded = (await new RendererStateStore(root).load(
      "conversation-history:large"
    )) as { content: string };
    expect(reloaded.content.length).toBe(content.length);
    expect(reloaded.content === content).toBe(true);
    await expect(
      new RendererStateStore(root).load("conversation-history:new")
    ).resolves.toEqual({ content: "新消息" });
  });

  it("migrates the old JSON once, preserving its original bytes", async () => {
    const { root, store } = await createStore();
    const key = "conversation-history:legacy";
    const original = JSON.stringify({
      version: 1,
      entries: { [key]: { content: "原始测试历史", extra: true } }
    });
    await mkdir(dirname(store.legacyStatePath), { recursive: true });
    await writeFile(store.legacyStatePath, original);
    await expect(store.load(key)).resolves.toEqual({
      content: "原始测试历史",
      extra: true
    });
    await store.save(key, { content: "迁移后保存" });
    expect(await readFile(store.legacyStatePath, "utf8")).toBe(original);
    await expect(new RendererStateStore(root).load(key)).resolves.toEqual({
      content: "迁移后保存"
    });
  });

  it("preserves malformed legacy JSON and refuses to overwrite it", async () => {
    const { store } = await createStore();
    await mkdir(dirname(store.legacyStatePath), { recursive: true });
    const original = "{ malformed placeholder";
    await writeFile(store.legacyStatePath, original);
    await expect(
      store.load("conversation-history:recovered")
    ).rejects.toThrow();
    await expect(
      store.save("conversation-history:recovered", { revision: 1 })
    ).rejects.toThrow();
    expect(await readFile(store.legacyStatePath, "utf8")).toBe(original);
  });
});
