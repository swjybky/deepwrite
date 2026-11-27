import {
  DECOMPOSITION_USAGE_LIMIT_FACTOR,
  addDecompositionUsage,
  decompositionUsageLimit,
  decompositionUsageTotal,
  getModelContentBlockReason,
  isModelQuotaExhausted,
  isSkippableDecompositionUnitId,
  type DecompositionControlInput,
  type DecompositionUsage,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import { prepareDecompositionTarget } from "./target-service";
import { copyReusedDecompositionRecords } from "./reuse";
import { resolveDecompositionConflict } from "./conflicts";
import type { DecompositionService } from "./service";
import { requeueDecompositionUnit } from "./unit-retry";
import { readDecompositionCards } from "./query-records";
import { replanDecompositionRegistry } from "./workflow";
import { settleDecompositionRegistryMerge } from "./submission-staging";

const tokens = (value: number) => value.toLocaleString("zh-CN");

/** Pauses after a package once usage passes the limit the user accepted. */
function pauseOverUsage(job: LongBookDecompositionJob) {
  const used = decompositionUsageTotal(job.usage);
  const limit = decompositionUsageLimit(job);
  if (job.status !== "idle" || job.phase === "done" || used <= limit) return;
  job.status = "stopped";
  job.lastError = `实际用量 ${tokens(used)} tokens 已超过暂停阈值 ${tokens(limit)}（预估上限的 ${DECOMPOSITION_USAGE_LIMIT_FACTOR} 倍或上次确认的额度），任务已暂停。点击继续会把阈值提高到 ${tokens(Math.ceil(used * 1.5))}。`;
}

export async function controlDecompositionJob(
  service: DecompositionService,
  input: DecompositionControlInput,
  usage?: DecompositionUsage
) {
  const job = await service.state.load(input.jobId);
  // Usage Main observed since the last control call; kept for any action.
  if (usage && input.action !== "delete") {
    job.usage = addDecompositionUsage(job.usage, usage);
    await service.state.save(job);
  }
  if (job.phase === "done" && ["resume", "stop", "end"].includes(input.action))
    return job;
  if (input.action === "delete") {
    if (job.status === "running") throw new Error("请先停止任务。");
    await service.state.remove(job.id);
    return null;
  }
  if (input.action === "stop") {
    job.status = "stopped";
    if (input.error) job.lastError = input.error;
    delete job.activeAttemptId;
    for (const unit of Object.values(job.units))
      if (["running", "writing"].includes(unit.status)) {
        unit.status = "pending";
        delete unit.attemptId;
        delete unit.runId;
      }
  } else if (input.action === "end") {
    if (job.status === "running") throw new Error("请先停止任务。");
    job.status = "ended";
    delete job.activeAttemptId;
    delete job.lastError;
    for (const unit of Object.values(job.units))
      if (["running", "writing"].includes(unit.status)) {
        unit.status = "pending";
        delete unit.attemptId;
        delete unit.runId;
      }
  } else if (input.action === "resume") {
    for (const [id, unit] of Object.entries(job.units))
      if (unit.conflictResolution)
        await resolveDecompositionConflict(
          job,
          id,
          "keep-user",
          service.longs,
          service.catalog,
          service.reader,
          () => service.state.save(job)
        );
    await service.recover(job, true);
    if (job.phase === "registry")
      replanDecompositionRegistry(
        job,
        await readDecompositionCards(job, service.reader)
      );
    // The user starts a new retry allowance for unfinished units only.
    // Keep their revision and partial receipts so saved work is reused.
    for (const unit of Object.values(job.units))
      if (unit.phase === job.phase && unit.status === "failed") {
        unit.status = "pending";
        unit.attempts = 0;
        delete unit.attemptId;
        delete unit.runId;
        delete unit.lastError;
      }
    job.status = "idle";
    delete job.lastError;
    // Continuing after a usage pause is the user's go-ahead for more.
    const used = decompositionUsageTotal(job.usage);
    if (used > decompositionUsageLimit(job)) {
      job.usageLimitTokens = Math.ceil(used * 1.5);
      delete job.lastError;
    }
    if (job.phase === "prepare_target") {
      const source = await service.source(job);
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
    }
    await copyReusedDecompositionRecords(
      job,
      service.reader,
      service.state,
      (id, data) => service.write(job, id, data)
    );
  } else if (input.action === "finish-package") {
    if (!input.attemptId || job.activeAttemptId !== input.attemptId)
      throw new Error("旧工作包不能结束当前运行。");
    const quota = input.failed && isModelQuotaExhausted(input.error);
    let firstFailedError: string | undefined;
    for (const [id, unit] of Object.entries(job.units))
      if (
        unit.attemptId === input.attemptId &&
        ["running", "writing"].includes(unit.status)
      ) {
        const unitError = (
          input.unitErrors?.[id] ??
          input.error ??
          unit.lastError ??
          "工作包未提交此单元。"
        ).slice(0, 2000);
        const contentBlocked = Boolean(getModelContentBlockReason(unitError));
        if (!quota) unit.attempts++;
        unit.status =
          !quota && (contentBlocked || unit.attempts >= 3)
            ? "failed"
            : "pending";
        unit.lastError = unitError;
        if (unit.status === "failed" && !firstFailedError)
          firstFailedError = unitError;
        delete unit.attemptId;
        delete unit.runId;
      }
    const failedUnit = Object.values(job.units).find(
      ({ status }) => status === "failed"
    );
    job.status = quota ? "stopped" : failedUnit ? "failed" : "idle";
    if (quota && input.error) job.lastError = input.error;
    else if (job.status === "failed") {
      const error = (
        firstFailedError ??
        failedUnit?.lastError ??
        input.error
      )?.slice(0, 2000);
      if (error) job.lastError = error;
    }
    delete job.activeAttemptId;
    pauseOverUsage(job);
  } else if (input.action === "skip" || input.action === "retry") {
    if (job.status === "running") throw new Error("请先停止任务。");
    const unit = input.unitId ? job.units[input.unitId] : undefined;
    if (!unit) throw new Error("单元不存在。");
    if (input.action === "skip") {
      if (!isSkippableDecompositionUnitId(input.unitId!))
        throw new Error("当前仅支持跳过阅读块或人物建档单元。");
      if (!["failed", "pending"].includes(unit.status) || job.phase === "done")
        throw new Error("只能跳过待处理或失败的单元。");
      unit.status = "skipped";
      delete unit.attemptId;
      delete unit.runId;
      for (const id of unit.dependencies) {
        const dependency = job.units[id];
        if (dependency && dependency.status !== "done") {
          dependency.status = "skipped";
          delete dependency.attemptId;
          delete dependency.runId;
        }
      }
      const remainingFailed = Object.values(job.units).find(
        ({ status }) => status === "failed"
      );
      if (remainingFailed) {
        job.status = "failed";
        if (remainingFailed.lastError)
          job.lastError = remainingFailed.lastError;
        else delete job.lastError;
      } else {
        job.status = "idle";
        delete job.lastError;
      }
    } else {
      if (
        !["failed", "skipped", "pending"].includes(unit.status) ||
        job.phase === "done"
      )
        throw new Error(
          "只能重试未完成、失败或跳过的单元；内容冲突请先选择处理方式。"
        );
      requeueDecompositionUnit(job, input.unitId!);
    }
  } else if (input.action === "resolve-conflict") {
    if (!input.unitId || !input.conflictChoice)
      throw new Error("请选择需要处理的冲突和处理方式。");
    await resolveDecompositionConflict(
      job,
      input.unitId,
      input.conflictChoice,
      service.longs,
      service.catalog,
      service.reader,
      () => service.state.save(job)
    );
  } else return service.advance(job);
  // Parts saved in earlier packages may leave a merge Core can finish alone.
  if (job.phase === "registry" && job.status !== "running")
    await settleDecompositionRegistryMerge(service, job).catch(() => false);
  await service.state.save(job);
  return job;
}
