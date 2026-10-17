import type {
  LongBookDecompositionJob,
  DecompositionSubmitInput,
  DecompositionAsset,
  DecompositionRegistry,
  DecompositionReceipt
} from "@deepwrite/contracts";
import { readDecompositionRegistry } from "./query";
import { emptyDecompositionRegistry } from "./workflow";
import { decompositionReceiptId } from "./identity";
import {
  decompositionMaterialSteps,
  writeDecompositionMaterialUnit
} from "./material-unit-writer";
import { writeDecompositionLongUnit } from "./long-unit-writer";
import { decompositionUnitIsRecordOnly } from "./record-store";
import type { DecompositionService } from "./service";

export interface PreparedDecompositionUnit {
  base: Omit<DecompositionReceipt, "refs">;
  registry: DecompositionRegistry;
  recordOnly: boolean;
}

export function prepareDecompositionUnit(
  job: LongBookDecompositionJob,
  unitId: string,
  data: DecompositionSubmitInput["data"],
  registry: DecompositionRegistry
): PreparedDecompositionUnit {
  const base = {
    id: decompositionReceiptId(
      job.id,
      job.outputVersion,
      unitId,
      job.units[unitId]!.inputRevision
    ),
    jobId: job.id,
    outputVersion: job.outputVersion,
    unitId,
    inputRevision: job.units[unitId]!.inputRevision,
    savedAt: new Date().toISOString()
  } satisfies Omit<DecompositionReceipt, "refs">;
  const recordOnly = decompositionUnitIsRecordOnly(job, unitId);
  job.units[unitId]!.requiredReceiptIds =
    !recordOnly && job.target?.kind === "material-group"
      ? decompositionMaterialSteps(job, unitId, data, base, registry).map(
          ({ receipt }) => receipt.id
        )
      : [base.id];
  return { base, registry, recordOnly };
}

export interface PersistDecompositionUnitOptions {
  prepared?: PreparedDecompositionUnit;
  saveState?: boolean;
}

/** Saves the task-local record first, then the finished content, if any, to the target. */
export async function persistDecompositionUnit(
  service: DecompositionService,
  job: LongBookDecompositionJob,
  unitId: string,
  data: DecompositionSubmitInput["data"],
  options: PersistDecompositionUnitOptions = {}
) {
  const prepared =
    options.prepared ??
    prepareDecompositionUnit(
      job,
      unitId,
      data,
      job.units["registry:merge"]?.status === "done"
        ? await readDecompositionRegistry(job, service.reader)
        : emptyDecompositionRegistry()
    );
  const { base, registry, recordOnly } = prepared;
  if (options.saveState !== false) await service.state.save(job);
  await service.records.save(job, unitId, data);
  if (recordOnly) return { ...base, refs: [] };
  if (job.target?.kind !== "long")
    return writeDecompositionMaterialUnit(
      service.catalog,
      job,
      unitId,
      data,
      base,
      registry,
      service.records
    );
  const assets: DecompositionAsset[] = [];
  if (data.kind === "asset" && data.asset.kind === "continuity") {
    for (const id of Object.keys(job.units).filter(
      (id) => id.startsWith("character:") && job.units[id]?.status === "done"
    )) {
      const record = await service.reader.record(job, id);
      if (record.data.kind === "asset") assets.push(record.data.asset);
    }
  }
  if (data.kind !== "reading")
    return writeDecompositionLongUnit(
      service.longs,
      job,
      unitId,
      data,
      base,
      registry,
      { assets }
    );
  // Segments of an oversized chapter share its card.
  const chapter = data.card.chapters[0]!;
  const chapterReadings = [chapter];
  for (const [id, unit] of Object.entries(job.units)) {
    if (
      id === unitId ||
      unit.status !== "done" ||
      (id !== `reading:${chapter.chapterId}` &&
        !id.startsWith(`reading:${chapter.chapterId}:`))
    )
      continue;
    const record = await service.reader.record(job, id);
    if (record.data.kind === "reading")
      chapterReadings.push(record.data.card.chapters[0]!);
  }
  return writeDecompositionLongUnit(
    service.longs,
    job,
    unitId,
    data,
    base,
    registry,
    {
      chapterReadings,
      sourceBody: (await service.source(job)).chapters.find(
        ({ id }) => id === chapter.chapterId
      )!.text
    }
  );
}
