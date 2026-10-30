import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decompositionFixture } from "./test-support";
import { decompositionUnitIsRecordOnly } from "./record-store";
import { runDecompositionFaux } from "./faux-run.test-support";
import { DesktopSyncWorkspace } from "../device-sync-workspace";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import {
  sameSyncContent,
  syncKey,
  LongProjectManifestSchema
} from "@deepwrite/contracts";
import { indexedFileSlots } from "../long-project-store/paths";
import { DEFAULT_WORLD_CATEGORIES } from "../long-project-store/types";
import {
  LONG_PORTABLE_BUNDLE_SCHEMA,
  LONG_PORTABLE_BUNDLE_SCHEMA_VERSION,
  parseLongPortableExportBundle
} from "../long-portable-bundle";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";

const roots: string[] = [];
afterEach(async () => {
  await cleanupDecompositionRoots(roots);
});

describe("整书拆解持久化工作流", () => {
  it.each(["continuation", "materials"] as const)(
    "通过固定子角色完成 %s 的真实目标",
    async (mode) => {
      const fixture = await decompositionFixture(
        mode,
        3,
        (order) =>
          `主角与人物1继续寻找铜铃。伏笔1${order === 3 ? "回收" : "埋设"}。`
      );
      roots.push(fixture.root);
      const { service } = fixture;
      expect(fixture.job.lastError).toBeUndefined();
      expect(fixture.job.phase).toBe("read");
      const job = await runDecompositionFaux(fixture);
      expect(job.status).toBe("completed");
      expect(job.phase).toBe("done");
      expect(
        Object.entries(job.units).every(
          ([id, { status, outputRefs }]) =>
            status === "done" &&
            (decompositionUnitIsRecordOnly(job, id) || outputRefs.length > 0)
        )
      ).toBe(true);
      // Working records live in the task directory, one per unit.
      const records = await readdir(
        join(service.state.directory(job.id), "records")
      );
      expect(records.length).toBeGreaterThanOrEqual(
        Object.keys(job.units).length
      );
      for (const id of Object.keys(job.units))
        await expect(service.reader.record(job, id)).resolves.toBeDefined();
      const saving = vi.spyOn(service.state, "save");
      const reloaded = await service.recover(
        await service.state.load(job.id),
        true
      );
      expect(reloaded.status).toBe("completed");
      expect(saving).not.toHaveBeenCalled();
      saving.mockRestore();
      expect(
        Object.values(reloaded.units).every(({ status }) => status === "done")
      ).toBe(true);
      const serialized = await readFile(
        join(service.state.directory(job.id), "job.json"),
        "utf8"
      );
      expect(serialized).not.toContain("coreProfile");
      const inventory = await new DesktopSyncWorkspace(
        fixture.userDataPath,
        async () => fixture.catalog,
        fixture.longs
      ).list();
      expect(inventory.issues).toEqual([]);
      const syncedFiles = inventory.items.flatMap((item) =>
        Object.keys(item.files)
      );
      expect(syncedFiles.some((path) => path.includes("receipts/"))).toBe(true);
      expect(syncedFiles).not.toContain("job.json");
      expect(syncedFiles).not.toContain("source.json");
      const receiverData = join(fixture.root, "receiver-data");
      const receiver = new DesktopSyncWorkspace(
        receiverData,
        async () => new FolderCatalogStore({ userDataPath: receiverData }),
        new LongWorkspaceService({ userDataPath: receiverData })
      );
      for (const item of inventory.items)
        await receiver.apply(
          syncKey(item),
          null,
          item,
          join(fixture.root, "receiver")
        );
      const restored = await receiver.list();
      expect(restored.issues).toEqual([]);
      expect(restored.items).toHaveLength(inventory.items.length);
      for (const item of inventory.items)
        expect(
          sameSyncContent(
            restored.items.find((value) => syncKey(value) === syncKey(item)) ??
              null,
            item
          )
        ).toBe(true);
      if (job.target?.kind === "long") {
        const book = (await fixture.longs.open({ bookId: job.target.bookId }))
          .book;
        expect(book.workspaceIndex.chapters).toHaveLength(3);
        const projectDirectory = (
          await fixture.longs.catalog.open(job.target.bookId)
        ).projectDirectory;
        expect(await readdir(join(projectDirectory, "long/analysis"))).toEqual([
          "receipts"
        ]);
        for (const chapter of book.workspaceIndex.chapters) {
          const card = await readFile(
            join(projectDirectory, chapter.card.path),
            "utf8"
          );
          expect(card).toContain("**关键事件**");
          expect(card).not.toMatch(/deepwrite-decomposition|reading:/u);
        }
        const titles = book.workspaceIndex.worldbuilding.map(
          ({ title }) => title
        );
        expect(new Set(titles).size).toBe(titles.length);
        expect(book.workspaceIndex.ledger.commits).toHaveLength(1);
        expect(
          Object.keys(
            (await service.state.completion(job.id)).postCommitRefs ?? {}
          )
        ).toEqual(["plot:foreshadowing"]);
        expect(book.workspaceIndex.plot.foreshadowing).toHaveLength(1);
        expect(
          book.workspaceIndex.plot.foreshadowing[0]!.beats.every(
            ({ status, commitId }) => status === "committed" && !!commitId
          )
        ).toBe(true);
        expect(
          book.workspaceIndex.chapters.every(
            ({ bodyStatus, commitId }) => bodyStatus === "written" && commitId
          )
        ).toBe(true);
        await service.advance(await service.state.load(job.id));
        expect(
          (await fixture.longs.open({ bookId: job.target.bookId })).book
            .workspaceIndex.ledger.commits
        ).toHaveLength(1);
        const opened = await fixture.longs.catalog.open(job.target.bookId);
        const index = opened.book.workspaceIndex;
        const item = inventory.items.find((item) => item.id === index.bookId)!;
        const sha256 = (content: string) =>
          createHash("sha256").update(content).digest("hex");
        const json = <T>(value: T) => ({
          mediaType: "application/json",
          value,
          sha256: sha256(`${JSON.stringify(value, null, 2)}\n`)
        });
        const bundle = parseLongPortableExportBundle({
          schema: LONG_PORTABLE_BUNDLE_SCHEMA,
          schemaVersion: LONG_PORTABLE_BUNDLE_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          bookId: index.bookId,
          manifest: json(
            LongProjectManifestSchema.parse(
              JSON.parse(item.files["deepwrite.json"]!)
            )
          ),
          index: json(index),
          files: indexedFileSlots(index).map(({ reference, kind }) => ({
            id: reference.id,
            path: reference.path,
            kind: kind === "json" ? "ledger-record" : "markdown",
            content: item.files[reference.path],
            sha256: sha256(item.files[reference.path]!)
          })),
          agentsMd: item.files["AGENTS.md"]
        });
        const sourcePath = join(fixture.root, "portable.json");
        await writeFile(sourcePath, JSON.stringify(bundle));
        const imported = await new LongWorkspaceService({
          userDataPath: join(fixture.root, "portable-user-data")
        }).importPortableBundle(join(fixture.root, "portable"), sourcePath);
        expect(imported.book.workspaceIndex.writeReceipts).toEqual(
          index.writeReceipts
        );
        for (const receipt of index.writeReceipts ?? [])
          expect(
            await readFile(
              join(imported.projectDirectory, receipt.path),
              "utf8"
            )
          ).toBe(item.files[receipt.path]);
      } else {
        const snapshot = await fixture.catalog.snapshot();
        expect(snapshot.materials).toHaveLength(5);
        expect(
          snapshot.materials.every(({ entries }) => entries.length > 0)
        ).toBe(true);
        const entries = snapshot.materials.flatMap(({ entries }) => entries);
        expect(
          entries.filter(({ title }) =>
            /通读记录|名册|审校记录|小传/u.test(title)
          )
        ).toEqual([]);
        for (const library of snapshot.materials) {
          const root = await fixture.catalog.managedProjectDirectory(
            library.id
          );
          for (const entry of library.entries)
            expect(
              await readFile(join(root, `entries/${entry.id}.md`), "utf8")
            ).not.toContain("deepwrite-decomposition");
        }
      }
    },
    60_000
  );

  it("拆到新长篇时世界观类别以所选模版为准，不留默认空类别", async () => {
    const fixture = await decompositionFixture("continuation", 2, undefined, {
      id: "decomposition-custom",
      name: "仙侠",
      description: "只拆宗门与功法。",
      systemPrompt: "",
      worldCategories: [
        { id: "sects", title: "宗门" },
        { id: "skills", title: "功法" }
      ]
    });
    roots.push(fixture.root);
    expect(fixture.job.lastError).toBeUndefined();
    const target = fixture.job.target;
    if (target?.kind !== "long") throw new Error("应拆到长篇。");
    const { bookId } = target;
    const world = async () =>
      (await fixture.longs.open({ bookId })).book.workspaceIndex.worldbuilding;
    expect((await world()).map(({ title }) => title)).toEqual(["宗门", "功法"]);
    const { projectDirectory } = await fixture.longs.catalog.open(bookId);
    for (const [id] of DEFAULT_WORLD_CATEGORIES)
      await expect(
        readFile(join(projectDirectory, `long/worldbuilding/${id}/overview.md`))
      ).rejects.toMatchObject({ code: "ENOENT" });

    const job = await runDecompositionFaux(fixture);
    expect(job.status).toBe("completed");
    const categories = await world();
    expect(
      categories.map((category) => ({
        title: category.title,
        order: category.order,
        filled: category.format === "list" && category.items.length > 0
      }))
    ).toEqual([
      { title: "宗门", order: 1, filled: true },
      { title: "功法", order: 2, filled: false }
    ]);
  }, 60_000);
});
