import { randomUUID } from "node:crypto";
import {
  AcademicWritingIndexSchema,
  createEnvelope,
  WritingFileSchema,
  WritingReadCommandSchema,
  WritingSearchResultSchema,
  type AcademicWritingIndex,
  type WritingFile,
  type WritingReadQuery,
  type WritingSearchResult
} from "@deepwrite/contracts";
import type { AgentRunInput } from "../runtime-types";

export interface AcademicWritingReader {
  runId: string;
  index(
    counts?: "workspace" | "draft",
    signal?: AbortSignal
  ): Promise<AcademicWritingIndex>;
  file(
    documentId: string,
    range?: { offset?: number; limit?: number },
    signal?: AbortSignal
  ): Promise<WritingFile>;
  search(
    query: string,
    limit?: number,
    signal?: AbortSignal
  ): Promise<WritingSearchResult>;
}

export function createAcademicWritingReader(
  input: AgentRunInput,
  bookId: string
): AcademicWritingReader | undefined {
  const execute = input.writingCommandExecutor;
  if (!execute) return undefined;
  const runQuery = async (query: WritingReadQuery, signal?: AbortSignal) => {
    const command = WritingReadCommandSchema.parse(
      createEnvelope(
        "catalog.readWritingWorkspace",
        { bookId, bookType: "academic", query },
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
    if (result.status !== "accepted") {
      throw new Error(
        input.promptLocale === "en-US"
          ? `Core could not read the saved academic work (${result.error.code}). Refresh the work directory and retry.`
          : `Core 无法读取已保存的学术作品（${result.error.code}）。请刷新作品目录后重试。`
      );
    }
    return result.payload;
  };
  return {
    runId: input.runId,
    index: async (counts, signal) =>
      AcademicWritingIndexSchema.parse(
        await runQuery({ mode: "index", ...(counts ? { counts } : {}) }, signal)
      ),
    file: async (documentId, range, signal) =>
      WritingFileSchema.parse(
        await runQuery({ mode: "file", documentId, ...range }, signal)
      ),
    search: async (query, limit, signal) =>
      WritingSearchResultSchema.parse(
        await runQuery(
          { mode: "search", query, ...(limit !== undefined ? { limit } : {}) },
          signal
        )
      )
  };
}
