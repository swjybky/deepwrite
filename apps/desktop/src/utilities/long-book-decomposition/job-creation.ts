import {
  LongBookDecompositionJobSchema,
  type DecompositionSubmissionData,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import { LongBookAnalysisSourceStore } from "../../extras/agents/sources/long-book-source-store";
import {
  planDecompositionTarget,
  prepareDecompositionTarget
} from "./target-service";
import { initializeDecompositionReading } from "./workflow";
import { copyReusedDecompositionRecords } from "./reuse";
import type { TargetPreparation } from "./job-state-store";
import type { DecompositionService } from "./service";
import { decompositionErrorMessage } from "./error-message";

export async function createDecompositionJob(
  service: DecompositionService,
  rawJob: LongBookDecompositionJob,
  paths: TargetPreparation["paths"]
) {
  const job = LongBookDecompositionJobSchema.parse(rawJob);
  const source = await service.source(job);
  const current = await new LongBookAnalysisSourceStore(
    service.state.workspaceDirectory
  ).load(job.source.sourceId);
  if (
    current.revision !== job.source.sourceRevision ||
    current.fingerprint !== job.source.fingerprint
  )
    throw new Error("来源已经重新校对，请确认新版本后建任务。");
  initializeDecompositionReading(job);
  const reused = new Map<string, DecompositionSubmissionData>();
  if (job.reusedFromJobId) {
    const reusable = await service.state.load(job.reusedFromJobId);
    if (
      reusable.source.fingerprint !== job.source.fingerprint ||
      JSON.stringify(reusable.source.range) !==
        JSON.stringify(job.source.range) ||
      JSON.stringify(reusable.profile.worldCategories) !==
        JSON.stringify(job.profile.worldCategories)
    )
      throw new Error("复用任务的来源、范围或设定类别不一致。");
    job.chunks = reusable.chunks;
    job.units = {};
    initializeDecompositionReading(job);
    for (const [id, unit] of Object.entries(reusable.units)) {
      if (
        (unit.phase === "read" || id.startsWith("registry:")) &&
        unit.status === "done"
      ) {
        reused.set(id, (await service.reader.record(reusable, id)).data);
        job.units[id] = {
          ...structuredClone(unit),
          // Receipts are scoped to the destination task, even for record-only units.
          receiptIds: [],
          requiredReceiptIds: undefined,
          runId: undefined,
          attemptId: undefined
        };
      }
    }
  }
  await service.state.initialize(job, planDecompositionTarget(job, paths));
  // Records belong to their task; the new task keeps its own copies.
  for (const [id, data] of reused) await service.records.save(job, id, data);
  try {
    await prepareDecompositionTarget(
      job,
      service.state,
      service.longs,
      service.catalog,
      source.chapters.filter(
        ({ order }) =>
          order >= job.source.range.start && order <= job.source.range.end
      )
    );
    await copyReusedDecompositionRecords(
      job,
      service.reader,
      service.state,
      (id, data) => service.write(job, id, data)
    );
  } catch (error) {
    job.status = "failed";
    job.lastError = decompositionErrorMessage(error, "目标准备失败。");
    await service.state.save(job);
  }
  return job;
}
