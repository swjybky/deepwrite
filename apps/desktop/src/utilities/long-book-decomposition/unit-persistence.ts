import type {
  LongBookDecompositionJob,
  DecompositionSubmitInput,
  DecompositionAsset
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

/** Look up a chapter's deterministic reading units without scanning all units. */
export function decompositionChapterReadingUnitIds(
  job: LongBookDecompositionJob,
  chapterId: string
): string[] {
  const prefix = `reading:${chapterId}`;
  const ids: string[] = [];
  if (job.units[prefix]) ids.push(prefix);
  for (let segment = 0; ; segment += 1) {
    const id = `${prefix}:${segment}`;
    if (!job.units[id]) break;
    ids.push(id);
  }
  return ids;
}

/** Saves the task-local record first, then the finished content, if any, to the target. */
export async function persistDecompositionUnit(
  service: DecompositionService,
  job: LongBookDecompositionJob,
  unitId: string,
  data: DecompositionSubmitInput["data"]
) {
  const registry =
    job.units["registry:merge"]?.status === "done"
      ? await readDecompositionRegistry(job, service.reader)
      : emptyDecompositionRegistry();
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
  };
  const recordOnly = decompositionUnitIsRecordOnly(job, unitId);
  job.units[unitId]!.requiredReceiptIds =
    !recordOnly && job.target?.kind === "material-group"
      ? decompositionMaterialSteps(job, unitId, data, base, registry).map(
          ({ receipt }) => receipt.id
        )
      : [base.id];
  await service.state.save(job);
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
  for (const id of decompositionChapterReadingUnitIds(job, chapter.chapterId)) {
    if (id === unitId || job.units[id]?.status !== "done") continue;
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
