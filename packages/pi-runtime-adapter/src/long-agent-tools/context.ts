import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  LongGetWorkspaceIndexCommandEnvelopeSchema,
  LongReadDocumentCommandEnvelopeSchema,
  LongReadDocumentResultSchema,
  LongWorkspaceIndexResultSchema,
  createEnvelope,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperation,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import {
  preflightLongMutationProposal,
  requireAccepted,
  requireExecutor,
  textResult,
  throwIfAborted
} from "./shared";
import {
  createProposalOverlay,
  type OverlayDocument
} from "./proposal-overlay";
import { AUTO_APPROVE_PROPOSAL_SUBMITTED } from "../write-approval";
import type {
  BuildLongWorkspaceToolsInput,
  LongAgentToolDetails,
  LongQueryCommandEnvelope
} from "./index";

/** Credential registered by `read`, required before overwriting existing text. */
export interface FullyReadDocumentEntry {
  content: string;
  file: LongWorkspaceFileReference;
}

export function longProposalResultSummary(
  input: BuildLongWorkspaceToolsInput,
  pendingSummary: string
): string {
  return input.writeApprovalMode === "auto-approve"
    ? pendingSummary
        .replace(/等待客户端审阅。$/u, AUTO_APPROVE_PROPOSAL_SUBMITTED)
        .replace(/等待客户端确认关联影响。$/u, AUTO_APPROVE_PROPOSAL_SUBMITTED)
    : pendingSummary;
}

let nextLongContextId = 0;

export function createLongToolContext(input: BuildLongWorkspaceToolsInput) {
  const contextId = ++nextLongContextId;
  const { workspace, profile } = input;
  if (
    profile.workspaceType !== "long" ||
    profile.id !== workspace.activeAgentId
  ) {
    throw new Error(
      "Long agent profile does not match the active workspace agent."
    );
  }

  const readableRoots = new Set(profile.readAccess.workspaceRoots);
  const writableRoots = new Set(profile.writeAccess.workspaceRoots);
  const capabilities = new Set(profile.writeAccess.capabilities);

  let indexPromise: Promise<LongWorkspaceIndexSnapshot> | undefined;
  let querySequence = 0;
  let indexSequence = 0;
  const retainedReads = new Map<
    string,
    { fingerprint: string; toolCallId: string }
  >();
  const fullyReadDocuments = new Map<string, FullyReadDocumentEntry>();
  /** Index-backed entities have no file, so their read credential is the body text. */
  const fullyReadRecords = new Map<string, string>();
  // Reads summarized away no longer authorize edits of existing text.
  input.onContextCompacted?.((removedToolCallIds) => {
    fullyReadDocuments.clear();
    fullyReadRecords.clear();
    if (removedToolCallIds === undefined) {
      retainedReads.clear();
      return;
    }
    const removed = new Set(removedToolCallIds);
    for (const [key, entry] of retainedReads) {
      if (!removed.has(entry.toolCallId)) continue;
      retainedReads.delete(key);
    }
  });
  const proposalOverlay =
    input.sharedState?.proposalOverlay ?? createProposalOverlay();

  const execute = async (
    command: LongQueryCommandEnvelope,
    signal?: AbortSignal
  ): Promise<unknown> => {
    throwIfAborted(signal);
    const result = await requireExecutor(input.executor)(command, signal);
    throwIfAborted(signal);
    return requireAccepted(result);
  };

  function raceWithAbort<T>(
    promise: Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    throwIfAborted(signal);
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        try {
          throwIfAborted(signal);
          reject(new Error("Operation aborted."));
        } catch (error) {
          reject(error);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  const loadIndex = async (
    signal?: AbortSignal
  ): Promise<LongWorkspaceIndexSnapshot> => {
    throwIfAborted(signal);
    if (!indexPromise) {
      indexPromise = proposalOverlay
        .coalesceIndexReload(() => {
          const command = LongGetWorkspaceIndexCommandEnvelopeSchema.parse(
            createEnvelope(
              "long.getWorkspaceIndex",
              { bookId: workspace.bookId },
              {
                id: `long-query-${input.runId}-c${contextId}-index-${++indexSequence}`,
                context: {
                  sessionId: input.sessionId,
                  runId: input.runId,
                  resourceId: workspace.bookId
                }
              }
            )
          );
          return execute(command)
            .then((payload) => LongWorkspaceIndexResultSchema.parse(payload))
            .then((result) => {
              if (result.bookId !== workspace.bookId) {
                throw new Error(
                  "Core returned a workspace index for another book."
                );
              }
              return result.workspaceIndex;
            });
        })
        .catch((error) => {
          indexPromise = undefined;
          throw error;
        });
    }
    const value = await raceWithAbort(indexPromise, signal);
    throwIfAborted(signal);
    return proposalOverlay.applyToIndex(value);
  };

  const reloadIndex = async (signal?: AbortSignal) => {
    indexPromise = undefined;
    return loadIndex(signal);
  };

  const readDocumentPage = async (
    file: LongWorkspaceFileReference,
    offset: number,
    maxCharacters: number,
    signal?: AbortSignal
  ) => {
    const command = LongReadDocumentCommandEnvelopeSchema.parse(
      createEnvelope(
        "long.readDocument",
        {
          bookId: workspace.bookId,
          fileId: file.id,
          offset,
          maxCharacters
        },
        {
          id: `long-query-${input.runId}-c${contextId}-read-${++querySequence}`,
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: workspace.bookId
          }
        }
      )
    );
    const result = LongReadDocumentResultSchema.parse(
      await execute(command, signal)
    );
    if (
      result.bookId !== workspace.bookId ||
      result.file.id !== file.id ||
      result.file.path !== file.path ||
      result.offset !== offset
    ) {
      throw new Error("Core returned a different long document.");
    }
    return result;
  };

  const readWholeDocument = async (
    file: LongWorkspaceFileReference,
    signal?: AbortSignal
  ): Promise<OverlayDocument> => {
    const pending = proposalOverlay.document(file.id);
    if (pending) return { ...pending };
    let offset = 0;
    let content = "";
    for (;;) {
      const result = await readDocumentPage(file, offset, 262_144, signal);
      content += result.content;
      if (result.nextOffset === null) {
        return { content, file: result.file };
      }
      offset = result.nextOffset;
    }
  };

  const readDocumentRange = async (
    file: LongWorkspaceFileReference,
    range: "head" | "tail",
    maximum: number,
    signal?: AbortSignal
  ): Promise<Pick<OverlayDocument, "content" | "fromContinuityProposal">> => {
    const pending = proposalOverlay.document(file.id);
    if (pending) {
      const characters = Array.from(pending.content);
      return {
        ...pending,
        content: (range === "head"
          ? characters.slice(0, maximum)
          : characters.slice(-maximum)
        ).join("")
      };
    }
    const first = await readDocumentPage(
      file,
      0,
      range === "head" ? maximum : 1,
      signal
    );
    if (range === "head" || first.totalCharacters <= 1)
      return { content: first.content };
    const offset = Math.max(0, first.totalCharacters - maximum);
    const tail = await readDocumentPage(file, offset, maximum, signal);
    if (
      tail.file.updatedAt !== first.file.updatedAt ||
      tail.totalCharacters !== first.totalCharacters
    ) {
      throw new Error("文档在范围读取时已有改动，请重新读取。");
    }
    return { content: tail.content };
  };

  const loadActiveChapterMutationContext = async (
    signal?: AbortSignal,
    chapterCardId?: string
  ): Promise<{
    index: LongWorkspaceIndexSnapshot;
    activeChapterCardId: string;
    chapter: LongWorkspaceIndexSnapshot["chapters"][number];
  }> => {
    const index = await reloadIndex(signal);
    const activeChapterCardId = chapterCardId ?? workspace.activeChapterCardId;
    if (!activeChapterCardId) {
      throw new Error("需要指定 chapter_card_id，或先选中一张待提交章卡。");
    }
    if (
      workspace.navigation.bookId !== index.bookId ||
      workspace.navigation.committedThroughChapterId !==
        index.ledger.committedThroughChapterId
    ) {
      throw new Error(
        "Long workspace context no longer matches the loaded workspace index."
      );
    }
    const chapter = index.chapters.find(
      (candidate) => candidate.chapterCardId === activeChapterCardId
    );
    if (!chapter) {
      throw new Error(
        "Long workspace target chapter no longer matches the loaded workspace index."
      );
    }
    if (chapter.commitId !== null) {
      throw new Error("The target long chapter is already committed.");
    }
    return { index, activeChapterCardId, chapter };
  };

  const formLongMutationProposal = (proposal: {
    index: LongWorkspaceIndexSnapshot;
    batch: LongWorkspaceOperationBatch;
    summary: string;
    message: string;
  }): AgentToolResult<LongAgentToolDetails> => {
    const preflightFailure = preflightLongMutationProposal(
      proposal.index,
      proposal.batch
    );
    if (preflightFailure) return preflightFailure;
    return textResult(longProposalResultSummary(input, proposal.message), {
      kind: "long-mutation-proposal",
      bookId: workspace.bookId,
      agentId: profile.id,
      batch: proposal.batch,
      summary: proposal.summary
    });
  };

  const rememberProposal = (input: {
    operations: readonly LongWorkspaceOperation[];
    changes: readonly {
      file: LongWorkspaceFileReference;
      afterText: string;
    }[];
    timestamp: string;
    fromContinuityProposal?: true;
  }): void => {
    const writes = input.changes.map<OverlayDocument>((change) => ({
      content: change.afterText,
      ...(input.fromContinuityProposal ? { fromContinuityProposal: true } : {}),
      file: {
        ...change.file,
        updatedAt: input.timestamp
      }
    }));
    proposalOverlay.remember(input.operations, writes);
    for (const write of writes) {
      fullyReadDocuments.set(write.file.id, {
        content: write.content,
        file: write.file
      });
    }
  };

  return {
    contextId,
    input,
    workspace,
    profile,
    readableRoots,
    writableRoots,
    capabilities,
    fullyReadDocuments,
    fullyReadRecords,
    retainedReads,
    execute,
    loadIndex,
    reloadIndex,
    readWholeDocument,
    readDocumentRange,
    loadActiveChapterMutationContext,
    formLongMutationProposal,
    rememberProposal
  };
}

export type LongToolContext = ReturnType<typeof createLongToolContext>;
