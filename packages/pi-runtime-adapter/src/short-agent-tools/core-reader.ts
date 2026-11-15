import { randomUUID } from "node:crypto";
import {
  createEnvelope,
  WritingReadCommandSchema,
  WritingFileSchema,
  WritingIndexSchema,
  type WritingReadQuery,
  type WritingFile,
  type WritingIndex
} from "@deepwrite/contracts";
import type { AgentRunInput } from "../runtime-types";

export interface WritingReader {
  runId: string;
  index(
    counts?: "workspace" | "draft",
    signal?: AbortSignal
  ): Promise<WritingIndex>;
  file(
    id: string,
    range?: { offset?: number; limit?: number },
    signal?: AbortSignal
  ): Promise<WritingFile>;
}
export function createWritingReader(
  input: AgentRunInput,
  bookId: string,
  bookType: "short" | "script"
): WritingReader | undefined {
  const execute = input.writingCommandExecutor;
  if (!execute) return undefined;
  const query = async (query: WritingReadQuery, signal?: AbortSignal) => {
    const command = WritingReadCommandSchema.parse(
      createEnvelope(
        "catalog.readWritingWorkspace",
        { bookId, bookType, query },
        {
          id: randomUUID(),
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: bookId
          }
        }
      )
    );
    const result = await execute(command, signal ?? input.signal);
    if (result.status !== "accepted")
      throw new Error(
        input.promptLocale === "en-US"
          ? `Core could not read the saved work (${result.error.code}). Refresh the work directory and retry.`
          : `Core 无法读取已保存的作品（${result.error.code}）。请刷新作品目录后重试。`
      );
    return result.payload;
  };
  return {
    runId: input.runId,
    index: async (counts, signal) =>
      WritingIndexSchema.parse(
        await query({ mode: "index", ...(counts ? { counts } : {}) }, signal)
      ),
    file: async (documentId, range, signal) =>
      WritingFileSchema.parse(
        await query({ mode: "file", documentId, ...range }, signal)
      )
  };
}
