import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readyDecompositionUnitIds } from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";
import { addDecompositionUnit } from "./workflow";
import { assertDecompositionObjectWritable } from "./content-guard";
import { sha256Hex } from "@deepwrite/shared/node";

const roots: string[] = [];
afterEach(async () => {
  await cleanupDecompositionRoots(roots);
});

async function completedPlotFixture() {
  const fixture = await decompositionFixture("materials", 1);
  roots.push(fixture.root);
  const { job } = fixture;
  job.phase = "integrate";
  job.units["chunk:1"]!.status = "done";
  addDecompositionUnit(job, "registry:merge", "registry", ["chunk:1"]);
  addDecompositionUnit(job, "plot:book-line", "integrate", ["chunk:1"]);
  const unit = job.units["plot:book-line"]!;
  Object.assign(unit, {
    status: "done",
    attempts: 2,
    outputRefs: [
      {
        projectId: "material_fixture",
        resourceId: "material_entry_fixture",
        revision: 1,
        sha256: "a".repeat(64)
      }
    ],
    receiptIds: ["receipt_previous"],
    requiredReceiptIds: ["receipt_previous"]
  });
  await fixture.service.state.save(job);
  return fixture;
}

it("persists a replanned unit without stale outputs and waits for its new dependency", async () => {
  const { job, service } = await completedPlotFixture();
  const revision = job.units["plot:book-line"]!.inputRevision;
  const writes = structuredClone(job.units["plot:book-line"]!.outputRefs);
  addDecompositionUnit(job, "plot:book-line", "integrate", [
    "chunk:1",
    "registry:merge"
  ]);
  await service.state.save(job);
  const restored = await service.state.load(job.id);
  const unit = restored.units["plot:book-line"]!;

  expect(unit.inputRevision).not.toBe(revision);
  expect(unit).toMatchObject({
    status: "pending",
    attempts: 0,
    outputRefs: [],
    receiptIds: []
  });
  expect(unit.requiredReceiptIds).toBeUndefined();
  expect(unit.previousOutputRefs).toEqual(writes);
  expect(readyDecompositionUnitIds(restored)).not.toContain("plot:book-line");
  restored.units["registry:merge"]!.status = "done";
  expect(readyDecompositionUnitIds(restored)).toContain("plot:book-line");
});

it("preserves a completed unit and its receipts when its dependencies are unchanged", async () => {
  const { job, service } = await completedPlotFixture();
  const previous = structuredClone(job.units["plot:book-line"]!);
  addDecompositionUnit(job, "plot:book-line", "integrate", ["chunk:1"]);
  await service.state.save(job);

  const restored = await service.state.load(job.id);
  expect(restored.units["plot:book-line"]).toEqual(previous);
  expect(readyDecompositionUnitIds(restored)).not.toContain("plot:book-line");
});

it("keeps edited index objects protected after dependency replanning", async () => {
  const { job, service } = await completedPlotFixture();
  addDecompositionUnit(job, "plot:book-line", "integrate", [
    "chunk:1",
    "registry:merge"
  ]);
  await service.state.save(job);
  const restored = await service.state.load(job.id);

  expect(() =>
    assertDecompositionObjectWritable(
      restored,
      "material_entry_fixture",
      sha256Hex("用户修改后的索引内容")
    )
  ).toThrow("decomposition.conflict");
});

it("updates unedited generated material after replanning and still rejects subsequent user edits", async () => {
  const fixture = await decompositionFixture("materials", 1);
  roots.push(fixture.root);
  const { job, service, catalog } = fixture;
  const id = "style:profile";
  const data = (content: string) => ({
    kind: "asset" as const,
    asset: { kind: "style" as const, content, excerpts: [] }
  });
  addDecompositionUnit(job, id, "integrate", ["chunk:1"]);
  const receipt = await service.write(job, id, data("原有生成结果。"));
  Object.assign(job.units[id]!, {
    status: "done",
    outputRefs: receipt.refs,
    receiptIds: [receipt.id]
  });
  addDecompositionUnit(job, "registry:merge", "registry", ["chunk:1"]);
  addDecompositionUnit(job, id, "integrate", ["chunk:1", "registry:merge"]);
  await service.state.save(job);
  const restored = await service.state.load(job.id);
  const updated = await service.write(restored, id, data("更新后的生成结果。"));
  expect(updated.refs[0]!.revision).toBeGreaterThan(receipt.refs[0]!.revision);

  const ref = updated.refs[0]!;
  Object.assign(restored.units[id]!, {
    status: "done",
    outputRefs: updated.refs,
    receiptIds: [updated.id]
  });
  const directory = await catalog.managedProjectDirectory(ref.projectId);
  const manifest = JSON.parse(
    await readFile(join(directory, "deepwrite.json"), "utf8")
  ) as { entries: Array<{ id: string; path: string }> };
  const path = join(
    directory,
    manifest.entries.find(({ id }) => id === ref.resourceId)!.path
  );
  const edited = `${await readFile(path, "utf8")}\n用户独立笔记。\n`;
  await writeFile(path, edited);
  addDecompositionUnit(restored, id, "integrate", ["registry:merge"]);
  await expect(
    service.write(restored, id, data("再次生成的结果。"))
  ).rejects.toThrow("decomposition.conflict");
  expect(await readFile(path, "utf8")).toBe(edited);
  expect(restored.units[id]!.previousOutputRefs).toHaveLength(1);
});
