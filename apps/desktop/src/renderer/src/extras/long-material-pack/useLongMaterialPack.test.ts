import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { useLongMaterialPackStore } from "./useLongMaterialPack";
import { longMaterialPackRunning } from "../../stores/longMaterialPackActivity";

const stats = (packs: unknown[] = []) => ({
  bookId: "longbook_a",
  title: "铜铃记",
  genre: "玄幻",
  worldCategories: 1,
  worldItems: 1,
  characters: { protagonist: 1, major: 0, minor: 0, passerby: 0, other: 0 },
  volumes: 1,
  arcs: 1,
  chapterCards: 5,
  writtenChapters: 4,
  foreshadowing: 0,
  storyEvents: 0,
  chapters: [1, 2, 3, 4, 5].map((n) => ({
    id: `chapter_${n}`,
    number: n,
    title: `第${n}章`,
    written: n !== 2
  })),
  packs
});
const result = {
  pack: {
    id: "lmpack_aaaaaaaa1",
    bookId: "longbook_a",
    bookTitle: "铜铃记",
    groupId: "group_a",
    entryCount: 3,
    updatedAt: "2026-10-08T00:00:00.000Z"
  },
  libraries: [],
  entries: [],
  counts: {
    new: 3,
    updated: 0,
    unchanged: 0,
    conflict: 0,
    stale: 0,
    deleted: 0
  }
};

function install() {
  const api = {
    events: { subscribe: vi.fn(() => () => undefined) },
    long: {
      list: vi.fn(async () => ({
        books: [
          { id: "longbook_old", updatedAt: "2026-01-01T00:00:00.000Z" },
          { id: "longbook_a", updatedAt: "2026-10-01T00:00:00.000Z" }
        ]
      }))
    },
    extrasAgents: {
      profiles: {
        list: vi.fn(async () => ({
          agentId: "long-material-guide",
          profiles: []
        }))
      }
    },
    longMaterialPack: {
      inspect: vi.fn(async () => stats()),
      preview: vi.fn(async () => ({ totalEntries: 3 })),
      convert: vi
        .fn()
        .mockRejectedValueOnce(new Error("disk full"))
        .mockResolvedValue(result),
      resolve: vi.fn(async () => result)
    }
  };
  vi.stubGlobal("window", { deepwrite: api });
  return api;
}

describe("long material pack page store", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.unstubAllGlobals());

  it("opens the newest book with three written sample chapters", async () => {
    const api = install();
    const store = useLongMaterialPackStore();
    await store.loadBooks();
    expect(api.longMaterialPack.inspect).toHaveBeenCalledWith({
      bookId: "longbook_a"
    });
    expect(store.sampleChapterIds).toEqual([
      "chapter_1",
      "chapter_3",
      "chapter_4"
    ]);
    expect(store.targetMode).toBe("create");
    expect(store.groupTitle).toContain("铜铃记");
  });

  it("marks a preview stale when the request changes", async () => {
    install();
    const store = useLongMaterialPackStore();
    await store.loadBooks();
    await store.runPreview();
    expect(store.previewStale).toBe(false);
    store.sections = store.sections.filter((section) => section !== "style");
    await nextTick();
    expect(store.previewStale).toBe(true);
  });

  it("retries a failed create with the same operation and then updates in place", async () => {
    const api = install();
    const store = useLongMaterialPackStore();
    await store.loadBooks();
    await store.convert(undefined);
    expect(store.result).toBeNull();
    await store.convert(undefined);
    const [first, second] = api.longMaterialPack.convert.mock.calls.map(
      ([input]) => input as { operationId: string; target: { action: string } }
    );
    expect(second!.operationId).toBe(first!.operationId);
    expect(store.result).toEqual(result);
    expect(store.targetMode).toBe("update");
    expect(store.packId).toBe("lmpack_aaaaaaaa1");
    expect(longMaterialPackRunning.value).toBe(false);
  });

  it("sends only the user's decisions when resolving", async () => {
    const api = install();
    const store = useLongMaterialPackStore();
    await store.loadBooks();
    await store.convert(undefined);
    await store.convert(undefined);
    await store.resolve({ "book-line:1": "overwrite", "gimmick:1": "remove" });
    expect(api.longMaterialPack.resolve).toHaveBeenCalledWith({
      packId: "lmpack_aaaaaaaa1",
      decisions: [
        { key: "book-line:1", action: "overwrite" },
        { key: "gimmick:1", action: "remove" }
      ]
    });
  });
});
