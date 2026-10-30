import { decompositionTargetEvent } from "./target-event";
import { createDecompositionSettledEvents } from "./settled-event";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import {
  DecompositionIdSchema,
  type CommandEnvelope,
  type CommandResult,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "../long-workspace-service";
import type { FolderCatalogStore } from "../folder-catalog-store";
import { planDecompositionTopic } from "./topic-plan";
import { DecompositionService } from "./service";
import { queryDecomposition, readDecompositionRegistry } from "./query";
import { readDecompositionUnitView } from "./unit-view";
import { runLongBookAnalysisSourceOperation } from "../long-book-analysis-sources";

export function withDecompositionCommands(
  userDataPath: string,
  requireCatalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService,
  handler: (command: CommandEnvelope) => Promise<CommandResult>
) {
  const registryPath = join(
    userDataPath,
    "long-book-decomposition-registry.json"
  );
  const queues = new Map<string, Promise<unknown>>();
  const settledEvent = createDecompositionSettledEvents();
  let registryTail: Promise<unknown> = Promise.resolve();
  const locations = new Map<string, string>();
  async function locate(id: string) {
    if (locations.has(id)) return locations.get(id)!;
    const raw: unknown = JSON.parse(await readFile(registryPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("任务注册表无效。");
    for (const [jobId, path] of Object.entries(raw))
      if (
        DecompositionIdSchema.safeParse(jobId).success &&
        typeof path === "string"
      )
        locations.set(jobId, path);
    const path = locations.get(id);
    if (!path) throw new Error("拆解任务未在 Core 注册。");
    return path;
  }
  function register(id: string, path: string) {
    const task = registryTail
      .catch(() => undefined)
      .then(async () => {
        let existing: Record<string, string> = {};
        try {
          existing = JSON.parse(await readFile(registryPath, "utf8")) as Record<
            string,
            string
          >;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (existing[id] && existing[id] !== path)
          throw new Error("任务目录不能切换。");
        locations.set(id, path);
        existing[id] = path;
        await mkdir(userDataPath, { recursive: true });
        const tmp = `${registryPath}.tmp-${process.pid}`;
        await writeFile(tmp, JSON.stringify(existing), { mode: 0o600 });
        await rename(tmp, registryPath);
      });
    registryTail = task;
    return task;
  }
  async function dispatch(command: CommandEnvelope): Promise<CommandResult> {
    try {
      if (command.type === "longBookDecomposition.coreCreate") {
        const { workspaceDirectory, job, paths } = command.payload;
        await register(job.id, workspaceDirectory);
        const service = new DecompositionService(
          workspaceDirectory,
          longs,
          await requireCatalog()
        );
        return {
          status: "accepted",
          requestId: command.id,
          payload: await runLongBookAnalysisSourceOperation(
            workspaceDirectory,
            () => service.create(job, paths)
          )
        };
      }
      if (command.type === "longBookDecomposition.coreAccess") {
        const { workspaceDirectory, operation, jobId } = command.payload;
        const service = new DecompositionService(
          workspaceDirectory,
          longs,
          await requireCatalog()
        );
        let payload: unknown;
        if (operation === "list") {
          payload = await service.state.list();
          for (const job of payload as Awaited<
            ReturnType<typeof service.state.list>
          >)
            await register(job.id, workspaceDirectory);
        } else {
          if (!jobId) throw new Error("缺少任务标识。");
          await register(jobId, workspaceDirectory);
          if (operation === "get")
            payload = await service.recover(
              await service.state.load(jobId),
              command.payload.recover
            );
          else if (operation === "control" && command.payload.control)
            payload = await service.control(
              command.payload.control,
              command.payload.usage
            );
          else if (
            operation === "open" &&
            command.payload.task &&
            command.payload.profileId &&
            command.payload.attemptId
          )
            payload = await service.open(
              command.payload.task,
              command.payload.profileId,
              command.payload.attemptId
            );
          else if (operation === "registry")
            payload = await readDecompositionRegistry(
              await service.state.load(jobId),
              service.reader
            );
          else if (operation === "save-registry" && command.payload.registry)
            payload = await service.saveRegistry(command.payload.registry);
          else if (operation === "unit" && command.payload.unitId)
            payload = await readDecompositionUnitView(
              await service.state.load(jobId),
              command.payload.unitId,
              service.reader
            );
          else if (operation === "results")
            payload = Object.entries((await service.state.load(jobId)).units)
              .filter(([, unit]) => unit.status === "done")
              .map(([unitId, unit]) => ({
                unitId,
                status: unit.status,
                refs: unit.outputRefs,
                title: unitId
              }));
          else throw new Error("任务操作输入不完整。");
        }
        return { status: "accepted", requestId: command.id, payload };
      }
      if (
        command.type === "longBookDecomposition.query" ||
        command.type === "longBookDecomposition.submitUnit" ||
        command.type === "longBookDecomposition.planTopic"
      ) {
        const workspace = await locate(command.payload.jobId);
        const service = new DecompositionService(
          workspace,
          longs,
          await requireCatalog()
        );
        const payload =
          command.type === "longBookDecomposition.planTopic"
            ? await planDecompositionTopic(
                service.state,
                command.payload,
                service.catalog
              )
            : command.type === "longBookDecomposition.submitUnit"
              ? await service.submit(command.payload)
              : await queryDecomposition(
                  await service.state.load(command.payload.jobId),
                  workspace,
                  service.reader,
                  command.payload.request
                );
        return { status: "accepted", requestId: command.id, payload };
      }
      return handler(command);
    } catch (error) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code:
            error instanceof Error &&
            error.message.includes("decomposition.conflict")
              ? "decomposition.conflict"
              : "decomposition.command_failed",
          message: error instanceof Error ? error.message : "拆解操作失败。"
        }
      };
    }
  }
  return (
    command: CommandEnvelope,
    emitEvent?: (event: SystemEventEnvelope) => void
  ): Promise<CommandResult> => {
    if (!command.type.startsWith("longBookDecomposition."))
      return handler(command);
    const key =
      command.type === "longBookDecomposition.coreCreate"
        ? command.payload.job.id
        : command.type === "longBookDecomposition.coreAccess"
          ? (command.payload.jobId ?? command.payload.workspaceDirectory)
          : command.type === "longBookDecomposition.query" ||
              command.type === "longBookDecomposition.submitUnit" ||
              command.type === "longBookDecomposition.planTopic"
            ? command.payload.jobId
            : "public";
    const previous = queues.get(key) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(async () => {
        const result = await dispatch(command);
        const event = decompositionTargetEvent(command, result);
        if (event) emitEvent?.(event);
        const settled = settledEvent(command, result);
        if (settled) emitEvent?.(settled);
        return result;
      });
    queues.set(key, result);
    void result.finally(() => {
      if (queues.get(key) === result) queues.delete(key);
    });
    return result;
  };
}
