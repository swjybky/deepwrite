import { LongBookAnalysisSourceStore } from "./long-book-sources/long-book-source-store";
import type { CommandEnvelope, CommandResult } from "@deepwrite/contracts";

const queues = new Map<string, Promise<unknown>>();
export function runLongBookAnalysisSourceOperation<T>(
  workspaceDirectory: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = queues.get(workspaceDirectory) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(operation);
  queues.set(workspaceDirectory, task);
  const clear = () => {
    if (queues.get(workspaceDirectory) === task)
      queues.delete(workspaceDirectory);
  };
  void task.then(clear, clear);
  return task;
}

export function withLongBookAnalysisSources(
  handler: (command: CommandEnvelope) => Promise<CommandResult>
) {
  return async (command: CommandEnvelope): Promise<CommandResult> => {
    if (command.type !== "longBookAnalysis.coreSource") return handler(command);
    const {
      workspaceDirectory,
      operation,
      source,
      sourceId,
      save,
      confirm,
      sourceRevision,
      confirmationId
    } = command.payload;
    return runLongBookAnalysisSourceOperation(
      workspaceDirectory,
      async (): Promise<CommandResult> => {
        try {
          const store = new LongBookAnalysisSourceStore(workspaceDirectory);
          let payload: unknown;
          if (operation === "import" && source) {
            await store.save(source);
            payload = await store.load(source.id);
          } else if (operation === "load" && sourceId)
            payload = await store.load(sourceId);
          else if (operation === "delete" && sourceId)
            payload = await store.remove(sourceId);
          else if (
            operation === "confirmed" &&
            sourceId &&
            sourceRevision &&
            confirmationId
          )
            payload = {
              source: await store.load(sourceId, sourceRevision),
              confirmation: await store.readConfirmation(
                sourceId,
                confirmationId
              )
            };
          else if (operation === "list") payload = await store.list();
          else if (operation === "save" && save)
            payload = await store.saveChapters(save);
          else if (operation === "confirm" && confirm)
            payload = await store.confirm(confirm);
          else throw new Error("来源操作输入不完整。");
          return { status: "accepted", requestId: command.id, payload };
        } catch (error) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "long_book_analysis.source_failed",
              message: error instanceof Error ? error.message : "来源保存失败。"
            }
          };
        }
      }
    );
  };
}
