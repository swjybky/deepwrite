import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RendererStateCapacityError,
  RendererStateSerializationError,
  RendererStateStore,
  DEFAULT_RENDERER_STATE_MAX_ITEM_BYTES,
  DEFAULT_RENDERER_STATE_MAX_TOTAL_BYTES
} from "./renderer-state-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createStore(
  options: ConstructorParameters<typeof RendererStateStore>[1] = {}
): Promise<{ root: string; store: RendererStateStore }> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-renderer-state-"));
  roots.push(root);
  return { root, store: new RendererStateStore(root, options) };
}

describe("RendererStateStore", () => {
  it("lists persisted history keys without including preferences", async () => {
    const { root, store } = await createStore();
    await store.save("conversation-history:book-one", { version: 1 });
    await store.save("conversation-preferences:options", {});
    expect(await new RendererStateStore(root).listHistoryKeys()).toEqual([
      "conversation-history:book-one"
    ]);
    await store.remove("conversation-history:book-one");
    expect(await store.listHistoryKeys()).toEqual([]);
  });

  it("persists JSON values in the application data directory and reloads them", async () => {
    const { root, store } = await createStore();
    const key = "conversation-history:book%3Aplaceholder";
    const value = {
      version: 1,
      selectedId: "conversation-placeholder",
      messages: [{ role: "user", content: "placeholder content" }]
    };

    await expect(store.load(key)).resolves.toBeUndefined();
    await store.save(key, value);
    await expect(store.load(key)).resolves.toEqual(value);

    const disk = JSON.parse(await readFile(store.statePath, "utf8")) as {
      version: number;
      entries: Record<string, unknown>;
    };
    expect(store.statePath).toBe(
      join(root, "renderer-state", "conversation-persistence.json")
    );
    expect(disk).toEqual({ version: 1, entries: { [key]: value } });
    await expect(new RendererStateStore(root).load(key)).resolves.toEqual(
      value
    );
  });

  it("serializes concurrent writes and leaves a complete atomic document", async () => {
    const { store } = await createStore();
    const key = "conversation-history:book-one";

    const first = store.save(key, { revision: 1 });
    const second = store.save("conversation-preferences:run-options:v1", {
      revision: 2
    });
    const latest = store.save(key, { revision: 3 });
    await Promise.all([first, second, latest]);

    await expect(store.load(key)).resolves.toEqual({ revision: 3 });
    await expect(
      store.load("conversation-preferences:run-options:v1")
    ).resolves.toEqual({
      revision: 2
    });
    expect(JSON.parse(await readFile(store.statePath, "utf8"))).toMatchObject({
      version: 1,
      entries: {
        [key]: { revision: 3 },
        "conversation-preferences:run-options:v1": { revision: 2 }
      }
    });
    expect(
      (await readdir(dirname(store.statePath))).filter((name) =>
        name.includes(".tmp-")
      )
    ).toEqual([]);
  });

  it("removes one key without disturbing other conversation state", async () => {
    const { root, store } = await createStore();
    const removedKey = "conversation-history:removed";
    const retainedKey = "conversation-history:retained";
    await store.save(removedKey, { value: "removed" });
    await store.save(retainedKey, { value: "retained" });

    await store.remove(removedKey);
    await store.remove("conversation-history:missing");

    await expect(store.load(removedKey)).resolves.toBeUndefined();
    await expect(
      new RendererStateStore(root).load(retainedKey)
    ).resolves.toEqual({
      value: "retained"
    });
  });

  it("rejects invalid keys and values that JSON would silently change", async () => {
    const { store } = await createStore();
    await expect(store.save("unscoped:key", { ok: true })).rejects.toThrow();
    await expect(
      store.save("conversation-history:undefined", undefined)
    ).rejects.toBeInstanceOf(RendererStateSerializationError);
    await expect(
      store.save("conversation-history:non-finite", { value: Number.NaN })
    ).rejects.toBeInstanceOf(RendererStateSerializationError);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(
      store.save("conversation-history:circular", circular)
    ).rejects.toBeInstanceOf(RendererStateSerializationError);

    await store.save("conversation-history:omitted-undefined", {
      ok: true,
      proposedText: undefined
    });
    await expect(
      store.load("conversation-history:omitted-undefined")
    ).resolves.toEqual({
      ok: true
    });
  });

  it("enforces per-item and aggregate byte limits without replacing valid state", async () => {
    const keyOne = "conversation-history:one";
    const keyTwo = "conversation-history:two";
    const firstValue = { content: "a".repeat(24) };
    const secondValue = { content: "b".repeat(24) };
    const documentWithBoth = `${JSON.stringify({
      version: 1,
      entries: { [keyOne]: firstValue, [keyTwo]: secondValue }
    })}\n`;
    const { root, store } = await createStore({
      maxItemBytes: 64,
      maxTotalBytes: Buffer.byteLength(documentWithBoth, "utf8") - 1
    });

    await store.save(keyOne, firstValue);
    await expect(store.save(keyTwo, secondValue)).rejects.toBeInstanceOf(
      RendererStateCapacityError
    );
    await expect(
      store.save("conversation-history:oversized", {
        content: "x".repeat(80)
      })
    ).rejects.toBeInstanceOf(RendererStateCapacityError);

    await expect(store.load(keyOne)).resolves.toEqual(firstValue);
    await expect(
      new RendererStateStore(root, {
        maxItemBytes: 64,
        maxTotalBytes: Buffer.byteLength(documentWithBoth, "utf8") - 1
      }).load(keyTwo)
    ).resolves.toBeUndefined();
  });

  it("preserves malformed on-disk JSON and refuses to overwrite it", async () => {
    const { store } = await createStore();
    await mkdir(dirname(store.statePath), { recursive: true });
    const original = "{ malformed placeholder";
    await writeFile(store.statePath, original, "utf8");
    await expect(
      store.load("conversation-history:recovered")
    ).rejects.toBeInstanceOf(RendererStateSerializationError);
    await expect(
      store.save("conversation-history:recovered", { revision: 1 })
    ).rejects.toBeInstanceOf(RendererStateSerializationError);
    expect(await readFile(store.statePath, "utf8")).toBe(original);
  });

  it("keeps evaluation-sized conversation envelopes under the default limits", () => {
    expect(DEFAULT_RENDERER_STATE_MAX_ITEM_BYTES).toBe(64 * 1024 * 1024);
    expect(DEFAULT_RENDERER_STATE_MAX_TOTAL_BYTES).toBe(256 * 1024 * 1024);
  });
});
