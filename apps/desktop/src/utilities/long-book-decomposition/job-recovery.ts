import type { LongBookDecompositionJob } from "@deepwrite/contracts";
import type { DecompositionService } from "./service";
import { decompositionErrorMessage } from "./error-message";
import { currentDecompositionRefs } from "./content-guard";
import { mapDecompositionReads } from "./read-cache";
import { decompositionUnitIsRecordOnly } from "./record-store";

export async function recoverDecompositionJob(
  service: DecompositionService,
  job: LongBookDecompositionJob,
  recoverInFlight = false
) {
  return service.reader.snapshot(async () => {
    const before = JSON.stringify(job);
    await service.assertSource(job);
    if (job.target) {
      const completion = await service.state.completion(job.id);
      const committed =
        !completion.finalized &&
        job.target.kind === "long" &&
        completion.commitId &&
        (
          await service.longs.catalog.open(job.target.bookId)
        ).book.workspaceIndex.ledger.commits.some(
          ({ id }) => id === completion.commitId
        );
      let receipts;
      try {
        receipts = await service.reader.receipts(
          job,
          committed ? completion.postCommitRefs : undefined
        );
      } catch (error) {
        job.target.state = "missing";
        job.status = "failed";
        job.lastError = decompositionErrorMessage(
          error,
          "真实目标或回执已移除。"
        );
        await service.state.save(job);
        return job;
      }
      if (job.target.kind === "long") {
        const durableRevision = receipts.reduce(
          (revision, receipt) =>
            Math.max(revision, ...receipt.refs.map((ref) => ref.revision)),
          job.target.baseRevision
        );
        job.target.baseRevision = durableRevision;
      } else {
        for (const receipt of receipts)
          for (const ref of receipt.refs) {
            const current = job.target.baseRevisions[ref.projectId] ?? 0;
            job.target.baseRevisions[ref.projectId] = Math.max(
              current,
              ref.revision
            );
          }
      }
      const received = new Set(receipts.map(({ unitId }) => unitId));
      const projects =
        job.target.kind === "long"
          ? [job.target.bookId]
          : Object.values(job.target.libraryIds);
      for (const [id, unit] of Object.entries(job.units)) {
        const awaitingReuse =
          job.reusedFromJobId &&
          unit.outputRefs.some(
            ({ projectId }) => !projects.includes(projectId)
          );
        if (unit.status === "done" && !received.has(id) && !awaitingReuse) {
          unit.status = "conflict";
          unit.lastError =
            "完成单元的持久化回执缺失或损坏，请修复回执或重新生成。";
        }
      }
      // A later write to a shared card or entry supersedes earlier refs to it.
      const current = new Set(
        currentDecompositionRefs(receipts.flatMap(({ refs }) => refs))
      );
      await mapDecompositionReads(receipts, async (receipt) => {
        const unit = job.units[receipt.unitId];
        if (!unit || receipt.inputRevision !== unit.inputRevision) return;
        try {
          if (
            receipt.refs.some(({ projectId }) => !projects.includes(projectId))
          )
            throw new Error("回执引用超出当前真实目标。");
          for (const ref of receipt.refs)
            if (current.has(ref)) await service.reader.validateRef(job, ref);
        } catch (error) {
          unit.status = "conflict";
          unit.outputRefs = receipt.refs;
          unit.lastError = decompositionErrorMessage(error, "真实内容冲突。");
          return;
        }
        unit.status = "done";
        delete unit.lastError;
        unit.outputRefs = receipt.refs;
        if (
          unit.requiredReceiptIds &&
          decompositionUnitIsRecordOnly(job, receipt.unitId)
        )
          unit.requiredReceiptIds = [receipt.id];
        unit.receiptIds = unit.requiredReceiptIds ?? [receipt.id];
      });
    }
    if (recoverInFlight && job.status === "running") {
      for (const unit of Object.values(job.units))
        if (["running", "writing"].includes(unit.status)) {
          unit.status = "pending";
          delete unit.attemptId;
          delete unit.runId;
        }
      job.status = "stopped";
      delete job.activeAttemptId;
    }
    if (JSON.stringify(job) !== before) await service.state.save(job);
    return job;
  });
}
