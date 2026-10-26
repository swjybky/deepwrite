import type { PathLike } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  LongBookDecompositionJobSchema,
  sameSyncContent
} from "@deepwrite/contracts";
import { decompositionFixture } from "./long-book-decomposition/test-support";
import { cleanupDecompositionRoots } from "./long-book-decomposition/fixture-cleanup.test-support";
import { DecompositionService } from "./long-book-decomposition/service";
import { LongWorkspaceService } from "./long-workspace-service";
import { desktopSyncInventory } from "./device-sync-inventory";
import {
  desktopSyncTestClient,
  desktopSyncTestPeer
} from "./device-sync.test-support";
import {
  MemoryDav,
  connect
} from "../extras/device-sync/engine/sync-test-support";

const fault = vi.hoisted(() => ({ manifest: "" }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: vi.fn(async (from: PathLike, to: PathLike) => {
      const staged = String(from).replaceAll("\\", "/");
      if (
        fault.manifest === String(to) &&
        staged.includes("/.deepwrite/transactions/") &&
        staged.includes("/stage/")
      ) {
        fault.manifest = "";
        throw new Error("synthetic interruption before manifest replacement");
      }
      return fs.rename(from, to);
    })
  };
});
const roots: string[] = [];
afterEach(async () => {
  fault.manifest = "";
  await cleanupDecompositionRoots(roots);
});

async function interruptedReading() {
  const initial = await decompositionFixture("continuation", 2);
  roots.push(initial.root);
  const longs = new LongWorkspaceService({
    userDataPath: initial.userDataPath,
    now: () => "2031-01-01T00:00:00.000Z"
  });
  const service = new DecompositionService(
    initial.root,
    longs,
    initial.catalog
  );
  const f = { ...initial, longs, service };
  if (f.job.target?.kind !== "long") throw new Error("missing target");
  const { projectDirectory } = await longs.catalog.open(f.job.target.bookId);
  const opened = await service.open(
    { jobId: f.job.id, phase: "read", unitIds: ["chunk:1"] },
    f.job.profile.id,
    "ldattempt_interrupted_sync"
  );
  const chapter = f.source.chapters[0]!;
  fault.manifest = join(projectDirectory, "deepwrite.json");
  await expect(
    service.submit({
      jobId: f.job.id,
      outputVersion: 1,
      attemptId: opened.input.attemptId,
      unitId: `reading:${chapter.id}`,
      inputRevision: opened.job.units[`reading:${chapter.id}`]!.inputRevision,
      data: {
        kind: "reading",
        card: {
          chunkId: "chunk:1",
          chapters: [
            {
              chapterId: chapter.id,
              order: chapter.order,
              title: chapter.title,
              summary: "主角继续寻找铜铃。",
              events: [],
              characters: []
            }
          ],
          characters: [],
          world: [],
          plot: { events: [], foreshadowing: [] },
          style: { notes: [], excerpts: [] }
        }
      }
    })
  ).rejects.toThrow("synthetic interruption");
  await service.control({ jobId: f.job.id, action: "stop" });
  const job = LongBookDecompositionJobSchema.parse({
    ...f.job,
    id: "ldjob_after_interruption",
    target: undefined,
    phase: "prepare_target",
    status: "idle",
    units: {}
  });
  return { ...f, projectDirectory, newJob: job };
}

it.each([false, true])(
  "拆书写盘中断后重建同名任务，先恢复旧作品再双端往返（删除任务记录=%s）",
  async (removeJob) => {
    const f = await interruptedReading();
    if (removeJob)
      await f.service.control({ jobId: f.job.id, action: "delete" });
    expect(
      (
        await f.service.create(f.newJob, {
          book: join(f.root, "books"),
          materials: join(f.root, "materials"),
          groups: join(f.root, "groups")
        })
      ).status
    ).toBe("idle");
    const journal = join(f.projectDirectory, ".deepwrite", "transaction.json");
    expect(await lstat(journal)).toBeDefined();
    const inventory = await desktopSyncInventory(f.userDataPath);
    expect(inventory.issues).toEqual([]);
    expect(inventory.items).toHaveLength(2);
    await expect(lstat(journal)).rejects.toMatchObject({ code: "ENOENT" });
    const index = JSON.parse(
      await readFile(join(f.projectDirectory, "long/index.json"), "utf8")
    );
    const manifest = JSON.parse(
      await readFile(join(f.projectDirectory, "deepwrite.json"), "utf8")
    );
    expect(manifest.updatedAt).toBe(index.updatedAt);
    expect(
      await readFile(
        join(f.projectDirectory, index.chapters[0].card.path),
        "utf8"
      )
    ).toContain("主角继续寻找铜铃");

    const dav = new MemoryDav();
    const sender = desktopSyncTestClient("sender", dav, f);
    const space = await connect(sender);
    expect((await sender.service.sync([], true)).issues).toEqual([]);
    const peer = await desktopSyncTestPeer(join(f.root, "receiver"), dav);
    await connect(peer.client, space);
    expect((await peer.client.service.sync([], true)).issues).toEqual([]);
    const received = await desktopSyncInventory(peer.userDataPath);
    expect(received.items).toHaveLength(2);
    for (const item of inventory.items) {
      expect(
        sameSyncContent(
          item,
          received.items.find(({ id }) => id === item.id)!
        )
      ).toBe(true);
      await expect(peer.longs.catalog.open(item.id)).resolves.toHaveProperty(
        "book.id",
        item.id
      );
    }
  }
);

it("拆书事务暂存损坏时不上传半成品，其他作品仍可同步且保留恢复材料", async () => {
  const f = await interruptedReading();
  await f.service.create(f.newJob, {
    book: join(f.root, "books"),
    materials: join(f.root, "materials"),
    groups: join(f.root, "groups")
  });
  const journalPath = join(
    f.projectDirectory,
    ".deepwrite",
    "transaction.json"
  );
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const staged = journal.operations.find(
    (operation: { path: string }) => operation.path === "deepwrite.json"
  ).stagePath;
  await writeFile(
    join(f.projectDirectory, staged),
    "synthetic damaged staged manifest"
  );
  const before = await readFile(journalPath, "utf8");
  const inventory = await desktopSyncInventory(f.userDataPath);
  expect(inventory.issues).toHaveLength(1);
  expect(inventory.items).toHaveLength(1);
  expect(await readFile(journalPath, "utf8")).toBe(before);
  const dav = new MemoryDav();
  const sender = desktopSyncTestClient("sender", dav, f);
  const space = await connect(sender);
  expect((await sender.service.sync([], true)).progress.phase).toBe("partial");
  const peer = await desktopSyncTestPeer(join(f.root, "receiver"), dav);
  await connect(peer.client, space);
  expect((await peer.client.service.sync([], true)).issues).toEqual([]);
  expect(
    (await desktopSyncInventory(peer.userDataPath)).items.map(({ id }) => id)
  ).toEqual(inventory.items.map(({ id }) => id));
});
