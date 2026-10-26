import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LongBookDecompositionJobSchema } from "@deepwrite/contracts";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";
import { runDecompositionFaux } from "./faux-run.test-support";
import { decompositionReceiptId } from "./identity";
import { decompositionUnitIsRecordOnly } from "./record-store";
import { readDecompositionRegistry } from "./query";
import { DecompositionService } from "./service";
import { decompositionFixture } from "./test-support";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupDecompositionRoots(roots);
});

it.each(["continuation", "materials"] as const)(
  "%s 复用完成结果后重启，以新任务自己的回执恢复并进入名册确认",
  async (mode) => {
    const f = await decompositionFixture(mode, 2);
    roots.push(f.root);
    f.job.autoContinue = false;
    await f.service.state.save(f.job);
    const source = await runDecompositionFaux(f, "registry_review");
    const job = LongBookDecompositionJobSchema.parse({
      ...source,
      id: "ldjob_reuse_recovery",
      reusedFromJobId: source.id,
      target: undefined,
      phase: "prepare_target",
      status: "idle",
      autoContinue: false,
      units: {}
    });
    const created = await f.service.create(job, {
      book: join(f.root, "books"),
      materials: join(f.root, "materials"),
      groups: join(f.root, "groups")
    });
    expect(created.status).toBe("idle");
    const restarted = new DecompositionService(
      f.root,
      new LongWorkspaceService({ userDataPath: f.userDataPath }),
      new FolderCatalogStore({ userDataPath: f.userDataPath })
    );
    // Older versions copied these receipt requirements from the source task.
    for (const [id, unit] of Object.entries(created.units))
      if (decompositionUnitIsRecordOnly(created, id)) {
        unit.requiredReceiptIds = source.units[id]!.requiredReceiptIds;
        unit.receiptIds = source.units[id]!.receiptIds;
      }
    await restarted.state.save(created);
    const recovered = await restarted.recover(
      await restarted.state.load(created.id),
      true
    );
    expect(
      Object.values(recovered.units).every((unit) => unit.status === "done")
    ).toBe(true);
    for (const [id, unit] of Object.entries(recovered.units))
      if (decompositionUnitIsRecordOnly(recovered, id))
        expect(unit.receiptIds).toEqual([
          decompositionReceiptId(
            recovered.id,
            recovered.outputVersion,
            id,
            unit.inputRevision
          )
        ]);
    const advanced = await restarted.control({
      jobId: created.id,
      action: "advance"
    });
    expect(advanced?.phase).toBe("registry_review");
    const before = await readDecompositionRegistry(advanced!, restarted.reader);
    const draft = structuredClone(before);
    draft.characters[0]!.tier = "major_supporting";
    const saved = await restarted.saveRegistry({
      jobId: created.id,
      baseRevision: before.version,
      registry: draft,
      confirm: false
    });
    const after = await readDecompositionRegistry(saved, restarted.reader);
    expect(after.version).toBe(before.version + 1);
    expect(after.characters[0]!.tier).toBe("major_supporting");
    await expect(
      restarted.saveRegistry({
        jobId: created.id,
        baseRevision: before.version,
        registry: before,
        confirm: false
      })
    ).rejects.toThrow("名册已在其他位置修改");
    expect(
      (await restarted.recover(await restarted.state.load(created.id))).status
    ).toBe("idle");
  }
);

it("复用目标已写入而任务状态未更新时，重启恢复真实回执且不重复写入", async () => {
  const f = await decompositionFixture("continuation", 1);
  roots.push(f.root);
  f.job.autoContinue = false;
  await f.service.state.save(f.job);
  const source = await runDecompositionFaux(f, "registry_review");
  const job = LongBookDecompositionJobSchema.parse({
    ...source,
    id: "ldjob_interrupted_reuse",
    reusedFromJobId: source.id,
    target: undefined,
    phase: "prepare_target",
    status: "idle",
    autoContinue: false,
    units: {}
  });
  const write = f.service.write.bind(f.service);
  let interrupted = false;
  vi.spyOn(f.service, "write").mockImplementation(async (...args) => {
    const receipt = await write(...args);
    if (!interrupted && args[1].startsWith("reading:")) {
      interrupted = true;
      throw new Error("synthetic interruption after target receipt");
    }
    return receipt;
  });
  const created = await f.service.create(job, {
    book: join(f.root, "books"),
    materials: join(f.root, "materials"),
    groups: join(f.root, "groups")
  });
  expect(created.status).toBe("failed");
  const restarted = new DecompositionService(f.root, f.longs, f.catalog);
  const rewrite = vi.spyOn(restarted, "write");
  const resumed = await restarted.control({ jobId: job.id, action: "resume" });
  expect(resumed?.status).toBe("idle");
  expect(
    Object.values(resumed!.units).every((unit) => unit.status === "done")
  ).toBe(true);
  expect(rewrite).not.toHaveBeenCalled();
  expect((await f.longs.catalog.list()).books).toHaveLength(2);
  expect(
    (await restarted.control({ jobId: job.id, action: "advance" }))?.phase
  ).toBe("registry_review");
});
