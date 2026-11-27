import type { LongBookDecompositionJob } from "@deepwrite/contracts";
import type { LongWorkspaceService } from "../long-workspace-service";
import type { DecompositionJobStateStore } from "./job-state-store";
import type { DecompositionRecordsReader } from "./records-reader";
import { addDecompositionUnit } from "./workflow";
import { readDecompositionRegistry } from "./query";
import { decompositionReceiptId } from "./identity";
import { writeDecompositionLongUnit } from "./long-unit-writer";

export async function completeDecompositionCharacterOverview(
  job: LongBookDecompositionJob,
  state: DecompositionJobStateStore,
  longs: LongWorkspaceService,
  reader: DecompositionRecordsReader
): Promise<void> {
  if (job.target?.kind !== "long") return;
  const unitId = "summary:characters";
  if (job.units[unitId]?.status === "done") return;
  const registry = await readDecompositionRegistry(job, reader);
  const groups = {
    protagonist: "主角",
    major_supporting: "主要配角",
    minor_supporting: "次要配角"
  };
  const sections = ["# 人物概览"];
  const dependencies: string[] = [];
  for (const [tier, label] of Object.entries(groups)) {
    const entries = registry.characters.filter(
      (entry) =>
        !entry.ignored &&
        entry.tier === tier &&
        job.units[`character:${entry.id}`]?.status !== "skipped"
    );
    if (!entries.length) continue;
    sections.push(`## ${label}`);
    for (const character of entries) {
      const id = `character:${character.id}`;
      const record = await reader.record(job, id);
      if (
        record.data.kind !== "asset" ||
        record.data.asset.kind !== "character"
      )
        throw new Error("人物概览依赖的正式档案缺失。");
      dependencies.push(id);
      sections.push(`### ${character.name}\n\n${record.data.asset.summary}`);
    }
  }
  addDecompositionUnit(job, unitId, "finalize", dependencies);
  const unit = job.units[unitId]!;
  const base = {
    id: decompositionReceiptId(
      job.id,
      job.outputVersion,
      unitId,
      unit.inputRevision
    ),
    jobId: job.id,
    outputVersion: job.outputVersion,
    unitId,
    inputRevision: unit.inputRevision,
    savedAt: new Date().toISOString()
  };
  unit.requiredReceiptIds = [base.id];
  await state.save(job);
  const data = {
    kind: "asset" as const,
    asset: {
      kind: "topic" as const,
      domain: "character" as const,
      title: "人物概览",
      content: sections.join("\n\n")
    }
  };
  await reader.records.save(job, unitId, data);
  const receipt = await writeDecompositionLongUnit(
    longs,
    job,
    unitId,
    data,
    base,
    registry
  );
  unit.status = "done";
  unit.outputRefs = receipt.refs;
  unit.receiptIds = [receipt.id];
  job.target.baseRevision++;
  await state.save(job);
}
