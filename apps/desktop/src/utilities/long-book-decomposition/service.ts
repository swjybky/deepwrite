import { recoverDecompositionJob } from "./job-recovery";
import { saveDecompositionRegistry } from "./job-registry";
import { controlDecompositionJob } from "./job-control";
import { advanceDecompositionJob } from "./job-advance";
import {
  persistDecompositionUnit,
  prepareDecompositionUnit,
  type PersistDecompositionUnitOptions
} from "./unit-persistence";
import { createDecompositionJob } from "./job-creation";
import {
  DecompositionResolvedInputSchema,
  decompositionInputBudget,
  type LongBookDecompositionJob,
  type DecompositionSubmitInput,
  type DecompositionTaskInput,
  type DecompositionControlInput,
  type DecompositionUsage,
  type DecompositionReadingCard,
  type DecompositionReceipt,
  type DecompositionSaveRegistryInput
} from "@deepwrite/contracts";
import { LongBookAnalysisSourceStore } from "../../extras/agents/sources/long-book-source-store";
import type { FolderCatalogStore } from "../folder-catalog-store";
import type { LongWorkspaceService } from "../long-workspace-service";
import {
  DecompositionJobStateStore,
  type TargetPreparation
} from "./job-state-store";
import { DecompositionRecordsReader } from "./records-reader";
import { DecompositionRecordStore } from "./record-store";
import { readDecompositionCards, readDecompositionRegistry } from "./query";
import {
  emptyDecompositionRegistry,
  readyDecompositionUnits
} from "./workflow";
import { assertDecompositionSubmission } from "./submission-validation";
import { canonicalDecompositionEvidence } from "./evidence-validation";
import {
  markDecompositionUnitDone,
  resolveDecompositionSubmission,
  settleDecompositionRegistryMerge,
  stageDecompositionPart
} from "./submission-staging";
import { decompositionErrorMessage } from "./error-message";

export class DecompositionService {
  readonly state: DecompositionJobStateStore;
  readonly records: DecompositionRecordStore;
  readonly reader: DecompositionRecordsReader;
  constructor(
    workspaceDirectory: string,
    readonly longs: LongWorkspaceService,
    readonly catalog: FolderCatalogStore
  ) {
    this.state = new DecompositionJobStateStore(workspaceDirectory);
    this.records = new DecompositionRecordStore((id) =>
      this.state.directory(id)
    );
    this.reader = new DecompositionRecordsReader(longs, catalog, this.records);
  }
  private async confirmedSourceStore(job: LongBookDecompositionJob) {
    const store = new LongBookAnalysisSourceStore(
      this.state.workspaceDirectory
    );
    const confirmation = await store.readConfirmation(
      job.source.sourceId,
      job.source.confirmationId
    );
    if (
      confirmation.fingerprint !== job.source.fingerprint ||
      confirmation.sourceRevision !== job.source.sourceRevision ||
      JSON.stringify(confirmation.range) !== JSON.stringify(job.source.range)
    )
      throw new Error("来源确认回执与任务输入不一致。");
    return store;
  }
  async assertSource(job: LongBookDecompositionJob): Promise<void> {
    const store = await this.confirmedSourceStore(job);
    const source = await store.inspectRevision(
      job.source.sourceId,
      job.source.sourceRevision
    );
    if (source.fingerprint !== job.source.fingerprint)
      throw new Error("来源已损坏或被篡改。");
  }
  async source(job: LongBookDecompositionJob) {
    const store = await this.confirmedSourceStore(job);
    const source = await store.load(
      job.source.sourceId,
      job.source.sourceRevision
    );
    if (source.fingerprint !== job.source.fingerprint)
      throw new Error("来源已损坏或被篡改。");
    return source;
  }
  create(rawJob: LongBookDecompositionJob, paths: TargetPreparation["paths"]) {
    return createDecompositionJob(this, rawJob, paths);
  }
  recover(job: LongBookDecompositionJob, recoverInFlight = false) {
    return recoverDecompositionJob(this, job, recoverInFlight);
  }
  async open(
    task: DecompositionTaskInput,
    profileId: string,
    attemptId: string
  ) {
    const job = await this.recover(await this.state.load(task.jobId));
    if (job.status === "running")
      throw new Error("此任务已有一个工作包正在运行。");
    if (
      job.profile.id !== profileId ||
      job.phase !== task.phase ||
      !job.target ||
      !["ready", "writing"].includes(job.target.state)
    )
      throw new Error("方案、阶段或目标状态与任务快照不一致。");
    const ready = readyDecompositionUnits(job);
    if (task.unitIds.some((id) => !ready.includes(id)))
      throw new Error("工作包包含未就绪、已完成或越界单元。");
    const authorized = new Set(task.unitIds);
    for (const id of task.unitIds)
      if (id.startsWith("chunk:"))
        job.units[id]!.dependencies.forEach((id) => authorized.add(id));
    for (const id of authorized)
      if (job.units[id]!.status !== "done") {
        job.units[id]!.status = "running";
        job.units[id]!.attemptId = attemptId;
      }
    job.status = "running";
    job.activeAttemptId = attemptId;
    job.target.state = "writing";
    delete job.lastError;
    await this.state.save(job);
    const model =
      task.phase === "read" ? job.models.reading : job.models.integration;
    return {
      job,
      input: DecompositionResolvedInputSchema.parse({
        ...task,
        outputVersion: job.outputVersion,
        attemptId,
        mode: job.mode,
        modelId: model.modelId,
        thinkingLevel: model.thinkingLevel,
        inputBudget: decompositionInputBudget(
          model,
          job.profile.systemPrompt.length
        ),
        contextWindow: model.contextWindow,
        ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
        units: Object.fromEntries(
          [...authorized].map((id) => [id, job.units[id]])
        )
      })
    };
  }
  write(
    job: LongBookDecompositionJob,
    unitId: string,
    data: DecompositionSubmitInput["data"],
    options?: PersistDecompositionUnitOptions
  ) {
    return persistDecompositionUnit(this, job, unitId, data, options);
  }
  async submit(submitted: DecompositionSubmitInput) {
    const job = await this.state.load(submitted.jobId);
    const source = await this.source(job);
    let cards: Promise<DecompositionReadingCard[]> | undefined;
    const readCards = () =>
      (cards ??= readDecompositionCards(job, this.reader));
    // Fields the source decides are filled in before the checks, so an
    // echoed title or a re-punctuated excerpt never costs a resubmission.
    const input = {
      ...submitted,
      data: canonicalDecompositionEvidence(
        job,
        submitted.unitId,
        await resolveDecompositionSubmission(
          this,
          job,
          submitted.unitId,
          submitted.data,
          readCards
        ),
        source
      )
    };
    const registry =
      job.units["registry:merge"]?.status === "done"
        ? await readDecompositionRegistry(job, this.reader)
        : emptyDecompositionRegistry();
    assertDecompositionSubmission(
      job,
      input,
      registry,
      input.data.kind === "registry" && input.unitId === "registry:merge"
        ? await readCards()
        : []
    );
    const unit = job.units[input.unitId]!;
    if (unit.status === "done") {
      const receipt = (await this.reader.receipts(job)).find(
        ({ unitId }) => unitId === input.unitId
      );
      if (!receipt) throw new Error("完成单元的持久化回执缺失。");
      return receipt;
    }
    if (input.data.kind === "asset-part")
      return stageDecompositionPart(this, job, input.unitId, input.data.asset);
    const prepared = prepareDecompositionUnit(
      job,
      input.unitId,
      input.data,
      registry
    );
    unit.status = "writing";
    await this.state.save(job);
    let receipt: DecompositionReceipt;
    try {
      receipt = await this.write(job, input.unitId, input.data, {
        prepared,
        saveState: false
      });
      markDecompositionUnitDone(job, input.unitId, receipt);
      if (input.data.kind === "review")
        for (const issue of input.data.review.issues) {
          const target = issue.unitId ? job.units[issue.unitId] : undefined;
          if (issue.resolution === "repair" && target?.phase === "integrate") {
            target.phase = "review";
            target.status = "pending";
            target.attempts = 0;
            target.inputRevision += `:review:${issue.id}`;
            delete target.attemptId;
          }
        }
      await this.state.save(job);
    } catch (error) {
      unit.status =
        error instanceof Error &&
        error.message.includes("decomposition.conflict")
          ? "conflict"
          : "running";
      unit.lastError = decompositionErrorMessage(error, "保存失败。");
      await this.state.save(job);
      throw error;
    }
    // The unit is saved; leftovers never turn that into a failure. A merge
    // Core cannot settle here stays pending for the registrar.
    await this.records.removeDraft(job, input.unitId).catch(() => undefined);
    if (input.unitId.startsWith("registry:part:"))
      await settleDecompositionRegistryMerge(this, job).catch(() => false);
    return receipt;
  }
  advance(job: LongBookDecompositionJob) {
    return advanceDecompositionJob(this, job);
  }
  control(input: DecompositionControlInput, usage?: DecompositionUsage) {
    return controlDecompositionJob(this, input, usage);
  }
  saveRegistry(input: DecompositionSaveRegistryInput) {
    return saveDecompositionRegistry(this, input);
  }
}
