import { randomUUID } from "node:crypto";
import {
  LongBookDecompositionJobSchema,
  DECOMPOSITION_MAX_CHARACTERS,
  LongBookAnalysisSourceSchema,
  DecompositionSourceConfirmationSchema,
  DecompositionCommandRecoverySchema,
  splitDecompositionChunks,
  estimateDecomposition,
  decompositionInputBudget,
  limitingDecompositionReadingModel,
  type CommandEnvelope,
  type CommandResult,
  type DecompositionModelsInput,
  type DecompositionModelSelection,
  type DecompositionResolvedModel,
  type DecompositionResolvedModels,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import {
  workspaceResourceParent,
  workspaceGroupParent
} from "../../../main/ipc/workspace-paths";
import type { ExtrasAgentCommandContext } from "../index";
import type { ExtrasAgentConfigStore } from "../config-store";
import { decompositionModelCapacity } from "./model-capacity";
import { UtilityCommandTimeoutError } from "../../../main/supervisor";
import { decompositionCore, controlWithUsage } from "./core-bridge";
import { rejectedResult } from "../../../main/ipc/errors";

async function resolveDecompositionModels(
  context: ExtrasAgentCommandContext,
  command: CommandEnvelope,
  models: DecompositionModelsInput,
  promptLength: number,
  existing?: LongBookDecompositionJob
): Promise<DecompositionResolvedModels> {
  const capacities = new Map<
    string,
    Promise<{ contextWindow: number; maxTokens?: number }>
  >();
  const resolveCapacity = (modelId: string) => {
    let pending = capacities.get(modelId);
    if (!pending) {
      const suffix = String(capacities.size);
      pending = (async () => {
        const model = await context.resolveModel(modelId);
        if (!model) {
          if (!context.evaluationMode)
            throw new Error("拆解模型不可用，请重新选择。");
          return { contextWindow: 128_000, maxTokens: 8192 };
        }
        const capacity = await decompositionModelCapacity(
          context.requestAgent,
          command,
          model,
          suffix
        );
        decompositionInputBudget(capacity, promptLength);
        return {
          contextWindow: capacity.contextWindow,
          ...(capacity.maxTokens !== undefined
            ? { maxTokens: capacity.maxTokens }
            : {})
        };
      })();
      capacities.set(modelId, pending);
    }
    return pending;
  };
  const resolveSlot = async (
    primary: DecompositionModelSelection,
    fallbacks: readonly DecompositionModelSelection[] = [],
    preserved?: {
      primary: DecompositionResolvedModel;
      fallbacks?: readonly DecompositionResolvedModel[];
    }
  ): Promise<{
    primary: DecompositionResolvedModel;
    fallbacks?: DecompositionResolvedModel[];
  }> => {
    if (preserved) {
      const nextList = [primary, ...fallbacks];
      const prevList = [preserved.primary, ...(preserved.fallbacks ?? [])];
      if (
        nextList.length === prevList.length &&
        nextList.every(
          (item, index) =>
            item.modelId === prevList[index]!.modelId &&
            item.thinkingLevel === prevList[index]!.thinkingLevel
        )
      ) {
        return {
          primary: preserved.primary,
          ...(preserved.fallbacks?.length
            ? { fallbacks: [...preserved.fallbacks] }
            : {})
        };
      }
    }
    const resolveItem = async (
      item: DecompositionModelSelection
    ): Promise<DecompositionResolvedModel> => ({
      ...item,
      ...(await resolveCapacity(item.modelId))
    });
    const resolvedPrimary = await resolveItem(primary);
    const resolvedFallbacks = await Promise.all(fallbacks.map(resolveItem));
    return {
      primary: resolvedPrimary,
      ...(resolvedFallbacks.length ? { fallbacks: resolvedFallbacks } : {})
    };
  };
  const preserveReading =
    existing && !["prepare_target", "read"].includes(existing.phase)
      ? {
          primary: existing.models.reading,
          ...(existing.models.readingFallbacks
            ? { fallbacks: existing.models.readingFallbacks }
            : {})
        }
      : undefined;
  const [reading, integration] = await Promise.all([
    resolveSlot(models.reading, models.readingFallbacks, preserveReading),
    resolveSlot(models.integration, models.integrationFallbacks)
  ]);
  return {
    reading: reading.primary,
    integration: integration.primary,
    ...(reading.fallbacks ? { readingFallbacks: reading.fallbacks } : {}),
    ...(integration.fallbacks
      ? { integrationFallbacks: integration.fallbacks }
      : {})
  };
}

export async function handleDecompositionCommands(
  context: ExtrasAgentCommandContext,
  config: ExtrasAgentConfigStore,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (
    !command.type.startsWith("longBookDecomposition.") ||
    command.type === "longBookDecomposition.coreCreate" ||
    command.type === "longBookDecomposition.coreAccess" ||
    command.type === "longBookDecomposition.query" ||
    command.type === "longBookDecomposition.submitUnit" ||
    command.type === "longBookDecomposition.planTopic"
  )
    return undefined;
  let createdJobId: string | undefined;
  try {
    if (command.type === "longBookDecomposition.createJob") {
      const {
        confirmation,
        models,
        mode,
        targetSelection,
        autoContinue,
        maxConcurrency,
        profileId,
        reuseJobId
      } = command.payload;
      const sourceResult = await decompositionCore(
        context,
        command,
        {
          operation: "confirmed",
          sourceId: confirmation.sourceId,
          sourceRevision: confirmation.sourceRevision,
          confirmationId: confirmation.id
        },
        "longBookAnalysis.coreSource"
      );
      if (sourceResult.status !== "accepted") return sourceResult;
      const raw = sourceResult.payload as {
        source: unknown;
        confirmation: unknown;
      };
      const source = LongBookAnalysisSourceSchema.parse(raw.source);
      const persisted = DecompositionSourceConfirmationSchema.parse(
        raw.confirmation
      );
      if (
        JSON.stringify(persisted) !== JSON.stringify(confirmation) ||
        source.fingerprint !== persisted.fingerprint
      )
        throw new Error("来源与持久化确认回执不一致。");
      const chapters = source.chapters.filter(
        ({ order }) =>
          order >= persisted.range.start && order <= persisted.range.end
      );
      const characterCount = chapters.reduce(
        (sum, { text }) => sum + text.length,
        0
      );
      if (characterCount > DECOMPOSITION_MAX_CHARACTERS)
        throw new Error(
          `单任务正文超过 ${DECOMPOSITION_MAX_CHARACTERS.toLocaleString("zh-CN")} 字符，请缩小章节范围。`
        );
      const profile = await config.resolve(
        "long-book-decomposition",
        profileId
      );
      const resolvedModels = await resolveDecompositionModels(
        context,
        command,
        models,
        profile.systemPrompt.length
      );
      const readingCapacity = limitingDecompositionReadingModel(
        [resolvedModels.reading, ...(resolvedModels.readingFallbacks ?? [])],
        profile.systemPrompt.length
      );
      const chunks = splitDecompositionChunks(
        chapters,
        readingCapacity,
        profile.systemPrompt.length
      );
      estimateDecomposition(chapters.length, characterCount, chunks.length);
      const now = new Date().toISOString();
      const job: LongBookDecompositionJob =
        LongBookDecompositionJobSchema.parse({
          schemaVersion: 1,
          id: `ldjob_${randomUUID().replaceAll("-", "")}`,
          createdAt: now,
          updatedAt: now,
          mode,
          outputVersion: 1,
          targetSelection,
          source: {
            sourceId: source.id,
            sourceRevision: persisted.sourceRevision,
            title: source.name,
            fingerprint: persisted.fingerprint,
            confirmationId: persisted.id,
            confirmedAt: persisted.confirmedAt,
            chapterCount: chapters.length,
            characterCount,
            range: persisted.range
          },
          profile,
          models: resolvedModels,
          chunks,
          chronicleSegments: [],
          phase: "prepare_target",
          status: "idle",
          autoContinue,
          maxConcurrency,
          units: {},
          ...(reuseJobId ? { reusedFromJobId: reuseJobId } : {})
        });
      const workspace = await context.getWorkspaceDirectory();
      if (!workspace) throw new Error("工作目录不存在。");
      createdJobId = job.id;
      const result = await decompositionCore(
        context,
        command,
        {
          job,
          paths: {
            book: workspaceResourceParent(workspace, "book"),
            materials: workspaceResourceParent(workspace, "material"),
            groups: workspaceGroupParent(workspace, "material")
          }
        },
        "longBookDecomposition.coreCreate"
      );
      return result.status === "rejected"
        ? {
            ...result,
            error: {
              ...result.error,
              details: {
                ...result.error.details,
                ...DecompositionCommandRecoverySchema.parse({ jobId: job.id })
              }
            }
          }
        : result;
    }
    if (command.type === "longBookDecomposition.listJobs")
      return await decompositionCore(context, command, { operation: "list" });
    if (command.type === "longBookDecomposition.getJob")
      return await decompositionCore(context, command, {
        operation: "get",
        jobId: command.payload.jobId,
        recover: ![...context.activeRuns.values()].some(
          (run) => run.decompositionJobId === command.payload.jobId
        )
      });
    if (command.type === "longBookDecomposition.control")
      return await controlWithUsage(context, command, command.payload);
    if (command.type === "longBookDecomposition.updateModels") {
      const activeRuns = context.activeRuns
        ? [...context.activeRuns.values()]
        : [];
      if (
        activeRuns.some(
          (run) => run.decompositionJobId === command.payload.jobId
        )
      )
        throw new Error("请先停止任务再切换模型。");
      const existingResult = await decompositionCore(context, command, {
        operation: "get",
        jobId: command.payload.jobId,
        recover: true
      });
      if (existingResult.status !== "accepted") return existingResult;
      const existing = LongBookDecompositionJobSchema.parse(
        existingResult.payload
      );
      if (existing.status === "running")
        throw new Error("请先停止任务再切换模型。");
      if (existing.phase === "done")
        throw new Error("任务已完成，无需切换模型。");
      const resolvedModels = await resolveDecompositionModels(
        context,
        command,
        command.payload.models,
        existing.profile.systemPrompt.length,
        existing
      );
      return await decompositionCore(context, command, {
        operation: "update-models",
        jobId: existing.id,
        models: resolvedModels
      });
    }
    if (command.type === "longBookDecomposition.getRegistry")
      return await decompositionCore(context, command, {
        operation: "registry",
        jobId: command.payload.jobId
      });
    if (command.type === "longBookDecomposition.saveRegistry")
      return await decompositionCore(context, command, {
        operation: "save-registry",
        jobId: command.payload.jobId,
        registry: command.payload
      });
    if (command.type === "longBookDecomposition.listResults")
      return await decompositionCore(context, command, {
        operation: "results",
        jobId: command.payload.jobId
      });
    if (command.type === "longBookDecomposition.readUnit")
      return await decompositionCore(context, command, {
        operation: "unit",
        jobId: command.payload.jobId,
        unitId: command.payload.unitId
      });
    return undefined;
  } catch (error) {
    return rejectedResult(
      command.id,
      error instanceof UtilityCommandTimeoutError
        ? "decomposition.command_timeout"
        : "decomposition.command_failed",
      error instanceof UtilityCommandTimeoutError
        ? "本地拆解操作等待超时，后台操作可能仍在进行。请刷新任务或点击继续，接续已保存的进度。"
        : error instanceof Error
          ? error.message
          : "拆解操作失败。",
      createdJobId
        ? DecompositionCommandRecoverySchema.parse({ jobId: createdJobId })
        : undefined
    );
  }
}
