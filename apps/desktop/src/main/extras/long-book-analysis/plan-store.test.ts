import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LongBookAnalysisPlan } from "@deepwrite/contracts";
import { LongBookAnalysisPlanStore } from "./plan-store";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function createStore(): Promise<{
  store: LongBookAnalysisPlanStore;
  userData: string;
}> {
  const userData = await mkdtemp(join(tmpdir(), "deepwrite-analysis-plan-"));
  temporaryRoots.push(userData);
  return { store: new LongBookAnalysisPlanStore(userData), userData };
}

function planFixture(overrides: Partial<LongBookAnalysisPlan> = {}) {
  return {
    version: 1 as const,
    id: "plan_test",
    sourceId: "source_test",
    sourceTitle: "测试书",
    sourceChapterCount: 120,
    modelId: "model_test",
    thinkingLevel: "off" as const,
    startOrder: 1,
    endOrder: 120,
    autoContinueOnLaunch: true,
    status: "running" as const,
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    tasks: [
      {
        id: "task_1",
        presetId: "plot-structure",
        presetName: "剧情结构",
        roundIndex: 0,
        startOrder: 1,
        endOrder: 50,
        libraryId: "material-1",
        status: "queued" as const,
        attempts: 0
      },
      {
        id: "task_2",
        presetId: "plot-structure",
        presetName: "剧情结构",
        roundIndex: 1,
        startOrder: 51,
        endOrder: 100,
        libraryId: "material-1",
        status: "completed" as const,
        attempts: 1,
        entry: { id: "entry_1", title: "第51-100章 · 剧情结构" },
        checkpoint: {
          batchIndex: 3,
          reductionRounds: 0,
          notes: [
            {
              id: "note_1",
              label: "第51-100章批次笔记",
              chapterStart: 51,
              chapterEnd: 100,
              text: "中间笔记"
            }
          ]
        }
      }
    ],
    ...overrides
  };
}

describe("LongBookAnalysisPlanStore", () => {
  it("round-trips a plan including checkpoints and written entries", async () => {
    const { store } = await createStore();
    await store.save(planFixture());

    const loaded = await store.load("plan_test");
    expect(loaded?.tasks).toHaveLength(2);
    expect(loaded?.tasks[1]?.checkpoint?.batchIndex).toBe(3);
    expect(loaded?.tasks[1]?.entry?.title).toBe("第51-100章 · 剧情结构");
    expect((await store.list()).map((plan) => plan.id)).toEqual(["plan_test"]);
  });

  it("returns nothing for an unknown plan instead of throwing", async () => {
    const { store } = await createStore();
    await expect(store.load("plan_missing")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });

  it("skips a corrupt plan file without losing the others", async () => {
    const { store, userData } = await createStore();
    await store.save(planFixture());
    await store.save(planFixture({ id: "plan_other" }));
    await writeFile(
      join(userData, "config", "long-book-analysis-plans", "plan_broken.json"),
      "{ not json"
    );

    const ids = (await store.list()).map((plan) => plan.id).sort();
    expect(ids).toEqual(["plan_other", "plan_test"]);
  });

  it("removes a plan and reports whether it existed", async () => {
    const { store } = await createStore();
    await store.save(planFixture());

    await expect(store.remove("plan_test")).resolves.toBe(true);
    await expect(store.remove("plan_test")).resolves.toBe(false);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("rejects plan ids that could escape the plan directory", async () => {
    const { store } = await createStore();
    for (const id of ["../escape", "a/b", "plan test", ""]) {
      await expect(
        store.remove(id),
        `应拒绝: ${JSON.stringify(id)}`
      ).rejects.toThrow();
    }
  });

  it("leaves no temporary files behind after saving", async () => {
    const { store, userData } = await createStore();
    await store.save(planFixture());
    await store.save(planFixture({ status: "paused" }));

    const files = await readdir(
      join(userData, "config", "long-book-analysis-plans")
    );
    expect(files.filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect((await store.load("plan_test"))?.status).toBe("paused");
  });

  it("ignores a symlinked plan file", async () => {
    const { store, userData } = await createStore();
    const directory = join(userData, "config", "long-book-analysis-plans");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(userData, "outside.json"),
      JSON.stringify(planFixture())
    );
    try {
      const { symlink } = await import("node:fs/promises");
      await symlink(
        join(userData, "outside.json"),
        join(directory, "plan_linked.json")
      );
    } catch {
      // Windows without the symlink privilege — the guard is covered by the
      // lstat branch and exercised on platforms that allow it.
      return;
    }

    await expect(store.list()).resolves.toEqual([]);
  });
});
