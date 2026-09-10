import type {
  AgentRuntimeRef,
  AgentUsage,
  LongCharacterFileChange
} from "@deepwrite/contracts";
import {
  AgentEvaluationSnapshotSchema,
  CharacterStructureMutationSchema,
  LongCharacterFileChangeSchema,
  LongChapterBodyChangeSchema,
  LongWorkspaceImpactConfirmationSchema,
  LongWorldbuildingFileChangeSchema,
  LongWorkspaceOperationBatchSchema
} from "@deepwrite/contracts";
import type {
  AgentApprovalMode,
  AgentEditProposal,
  AgentSubagentProcessingStep,
  AgentSubagentRun,
  AgentTextDiffHunk,
  AgentTextDiffLine,
  AgentToolTrace,
  ChatMessage
} from "../../types/conversation";
import { isRecord, nonnegativeInteger, validDate } from "./shared";

import {
  parseStoredDiscardSnapshot,
  parseStoredDiscardState
} from "../../utils/acceptedEditDiscardPersistence";
import {
  isStoredLongProposalCandidate,
  normalizeStoredLongProposalStatusMessage,
  normalizeStoredLongProposalTarget
} from "./long-proposal-persistence-compatibility";

import { parseStoredLibraryTarget } from "./library-target";

function parseStoredTextDiffLine(
  value: unknown
): AgentTextDiffLine | undefined {
  if (
    !isRecord(value) ||
    !["context", "addition", "deletion"].includes(String(value.type)) ||
    typeof value.text !== "string" ||
    (value.oldLineNumber !== undefined &&
      !nonnegativeInteger(value.oldLineNumber)) ||
    (value.newLineNumber !== undefined &&
      !nonnegativeInteger(value.newLineNumber))
  ) {
    return undefined;
  }
  return {
    type: value.type as AgentTextDiffLine["type"],
    text: value.text,
    ...(value.oldLineNumber === undefined
      ? {}
      : { oldLineNumber: value.oldLineNumber as number }),
    ...(value.newLineNumber === undefined
      ? {}
      : { newLineNumber: value.newLineNumber as number })
  };
}

function parseStoredTextDiffHunk(
  value: unknown
): AgentTextDiffHunk | undefined {
  if (
    !isRecord(value) ||
    !nonnegativeInteger(value.oldStart) ||
    !nonnegativeInteger(value.oldLines) ||
    !nonnegativeInteger(value.newStart) ||
    !nonnegativeInteger(value.newLines) ||
    !Array.isArray(value.lines)
  ) {
    return undefined;
  }
  const lines = value.lines
    .map(parseStoredTextDiffLine)
    .filter((line): line is AgentTextDiffLine => line !== undefined);
  if (lines.length !== value.lines.length) return undefined;
  return {
    oldStart: value.oldStart,
    oldLines: value.oldLines,
    newStart: value.newStart,
    newLines: value.newLines,
    lines
  };
}

function parseStoredDraftSectionCreationTarget(
  value: unknown
): AgentEditProposal["draftSectionCreationTarget"] | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sections) ||
    value.sections.length === 0
  ) {
    return undefined;
  }
  const sections: Array<{
    title: string;
    wordCountRequirement: string;
    provisionalSectionId: string;
    realSectionId?: string;
    bodyContent?: string;
    characterStateContent?: string;
  }> = [];
  for (const [index, section] of value.sections.entries()) {
    if (
      !isRecord(section) ||
      typeof section.title !== "string" ||
      typeof section.wordCountRequirement !== "string" ||
      (section.bodyContent !== undefined &&
        typeof section.bodyContent !== "string") ||
      (section.characterStateContent !== undefined &&
        typeof section.characterStateContent !== "string") ||
      (section.realSectionId !== undefined &&
        typeof section.realSectionId !== "string")
    ) {
      return undefined;
    }
    sections.push({
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      provisionalSectionId:
        typeof section.provisionalSectionId === "string" &&
        section.provisionalSectionId.trim()
          ? section.provisionalSectionId
          : `pending:section:legacy-${index + 1}`,
      ...(typeof section.realSectionId === "string"
        ? { realSectionId: section.realSectionId }
        : {}),
      ...(typeof section.bodyContent === "string"
        ? { bodyContent: section.bodyContent }
        : {}),
      ...(typeof section.characterStateContent === "string"
        ? { characterStateContent: section.characterStateContent }
        : {})
    });
  }
  if (
    value.afterSectionId !== undefined &&
    typeof value.afterSectionId !== "string"
  ) {
    return undefined;
  }
  if (
    value.baseProjectRevision !== undefined &&
    !nonnegativeInteger(value.baseProjectRevision)
  ) {
    return undefined;
  }
  if (
    value.acceptedDirectoryRevision !== undefined &&
    typeof value.acceptedDirectoryRevision !== "string"
  ) {
    return undefined;
  }
  return {
    sections,
    ...(typeof value.afterSectionId === "string"
      ? { afterSectionId: value.afterSectionId }
      : {}),
    ...(typeof value.baseProjectRevision === "number"
      ? { baseProjectRevision: value.baseProjectRevision }
      : {}),
    ...(typeof value.acceptedDirectoryRevision === "string"
      ? { acceptedDirectoryRevision: value.acceptedDirectoryRevision }
      : {})
  };
}

function parseStoredDraftSectionRenameTarget(
  value: unknown
): AgentEditProposal["draftSectionRenameTarget"] | undefined {
  if (
    !isRecord(value) ||
    typeof value.sectionId !== "string" ||
    !value.sectionId.trim() ||
    typeof value.previousTitle !== "string" ||
    !value.previousTitle.trim() ||
    typeof value.title !== "string" ||
    !value.title.trim()
  ) {
    return undefined;
  }
  if (
    value.baseProjectRevision !== undefined &&
    !nonnegativeInteger(value.baseProjectRevision)
  ) {
    return undefined;
  }
  return {
    sectionId: value.sectionId,
    previousTitle: value.previousTitle,
    title: value.title,
    ...(typeof value.baseProjectRevision === "number"
      ? { baseProjectRevision: value.baseProjectRevision }
      : {})
  };
}

function parseStoredDraftSectionDeletionTarget(
  value: unknown
): AgentEditProposal["draftSectionDeletionTarget"] | undefined {
  if (
    !isRecord(value) ||
    typeof value.sectionId !== "string" ||
    !value.sectionId.trim() ||
    typeof value.title !== "string" ||
    !value.title.trim()
  ) {
    return undefined;
  }
  if (
    value.baseProjectRevision !== undefined &&
    !nonnegativeInteger(value.baseProjectRevision)
  ) {
    return undefined;
  }
  return {
    sectionId: value.sectionId,
    title: value.title,
    ...(typeof value.baseProjectRevision === "number"
      ? { baseProjectRevision: value.baseProjectRevision }
      : {})
  };
}

function parseStoredCharacterStructureTarget(
  value: unknown
): AgentEditProposal["characterStructureTarget"] | undefined {
  if (!isRecord(value)) return undefined;
  const mutation = CharacterStructureMutationSchema.safeParse(value.mutation);
  if (!mutation.success) return undefined;
  if (
    (value.initialContent !== undefined &&
      typeof value.initialContent !== "string") ||
    (value.baseProjectRevision !== undefined &&
      !nonnegativeInteger(value.baseProjectRevision))
  ) {
    return undefined;
  }
  return {
    mutation: mutation.data,
    ...(typeof value.initialContent === "string"
      ? { initialContent: value.initialContent }
      : {}),
    ...(value.baseProjectRevision === undefined
      ? {}
      : { baseProjectRevision: value.baseProjectRevision })
  };
}

function parseStoredPlotStructureTarget(
  value: unknown
): AgentEditProposal["plotStructureTarget"] | undefined {
  if (!isRecord(value) || !isRecord(value.mutation)) return undefined;
  const mutation = value.mutation;
  const baseProjectRevision = value.baseProjectRevision;
  if (
    baseProjectRevision !== undefined &&
    !nonnegativeInteger(baseProjectRevision)
  ) {
    return undefined;
  }
  if (
    mutation.type === "create" &&
    typeof mutation.title === "string" &&
    typeof mutation.description === "string" &&
    typeof mutation.provisionalStageId === "string" &&
    typeof mutation.content === "string"
  ) {
    return {
      mutation: {
        type: "create",
        title: mutation.title,
        description: mutation.description,
        provisionalStageId: mutation.provisionalStageId,
        content: mutation.content
      },
      ...(typeof baseProjectRevision === "number"
        ? { baseProjectRevision }
        : {})
    };
  }
  if (
    mutation.type === "update" &&
    typeof mutation.stageId === "string" &&
    typeof mutation.previousTitle === "string" &&
    typeof mutation.title === "string" &&
    typeof mutation.description === "string"
  ) {
    return {
      mutation: {
        type: "update",
        stageId: mutation.stageId,
        previousTitle: mutation.previousTitle,
        title: mutation.title,
        description: mutation.description
      },
      ...(typeof baseProjectRevision === "number"
        ? { baseProjectRevision }
        : {})
    };
  }
  return undefined;
}

function parseStoredLongWorldbuildingTarget(
  value: unknown
): AgentEditProposal["longWorldbuildingTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim()
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const file = LongWorldbuildingFileChangeSchema.safeParse(value.file);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    !file.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  )
    return undefined;
  return {
    bookId: value.bookId,
    batch: batch.data,
    file: file.data,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}

function parseStoredLongCharacterTarget(
  value: unknown
): AgentEditProposal["longCharacterTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim() ||
    !Array.isArray(value.files) ||
    value.files.length < 1
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  )
    return undefined;
  const files: LongCharacterFileChange[] = [];
  for (const file of value.files) {
    const parsed = LongCharacterFileChangeSchema.safeParse(file);
    if (!parsed.success) return undefined;
    files.push(parsed.data);
  }
  return {
    bookId: value.bookId,
    batch: batch.data,
    files,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}

function parseStoredLongPlotDesignTarget(
  value: unknown
): AgentEditProposal["longPlotDesignTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim()
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  )
    return undefined;
  return {
    bookId: value.bookId,
    batch: batch.data,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}

function parseStoredLongDraftTarget(
  value: unknown
): AgentEditProposal["longDraftTarget"] | undefined {
  value = normalizeStoredLongProposalTarget(value);
  if (
    !isRecord(value) ||
    typeof value.bookId !== "string" ||
    !value.bookId.trim()
  ) {
    return undefined;
  }
  const batch = LongWorkspaceOperationBatchSchema.safeParse(value.batch);
  const file = LongChapterBodyChangeSchema.safeParse(value.file);
  const expectedImpact =
    value.expectedImpact === undefined
      ? undefined
      : LongWorkspaceImpactConfirmationSchema.safeParse(value.expectedImpact);
  if (
    !batch.success ||
    !file.success ||
    (expectedImpact !== undefined && !expectedImpact.success)
  ) {
    return undefined;
  }
  return {
    bookId: value.bookId,
    batch: batch.data,
    file: file.data,
    ...(expectedImpact?.success ? { expectedImpact: expectedImpact.data } : {})
  };
}

function parseStoredEditProposal(
  value: unknown
): AgentEditProposal | undefined {
  const isLongFormProposalCandidate = isStoredLongProposalCandidate(value);
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.stageId !== "string" ||
    value.stageId.length > 120 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value.stageId) ||
    typeof value.documentId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    ![
      "pending",
      "accepting",
      "accepted",
      "rejected",
      "conflict",
      "error"
    ].includes(String(value.status)) ||
    (!isLongFormProposalCandidate && typeof value.baseRevision !== "string") ||
    (!isLongFormProposalCandidate &&
      typeof value.proposedRevision !== "string") ||
    (value.proposedText !== undefined &&
      typeof value.proposedText !== "string") ||
    !Array.isArray(value.toolCallIds) ||
    !value.toolCallIds.every((toolCallId) => typeof toolCallId === "string") ||
    !nonnegativeInteger(value.additions) ||
    !nonnegativeInteger(value.deletions) ||
    !Array.isArray(value.hunks) ||
    (value.truncated !== undefined && typeof value.truncated !== "boolean") ||
    (value.statusMessage !== undefined &&
      typeof value.statusMessage !== "string") ||
    (value.laneId !== undefined && typeof value.laneId !== "string") ||
    (value.generation !== undefined &&
      (!nonnegativeInteger(value.generation) || value.generation < 1)) ||
    (value.approvalMode !== undefined &&
      value.approvalMode !== "request-approval" &&
      value.approvalMode !== "auto-approve") ||
    (value.predecessorProposalId !== undefined &&
      typeof value.predecessorProposalId !== "string") ||
    (!isLongFormProposalCandidate &&
      value.sourceBaseRevision !== undefined &&
      typeof value.sourceBaseRevision !== "string") ||
    (value.decisionToken !== undefined &&
      typeof value.decisionToken !== "string") ||
    (value.provisionalExpertSection !== undefined &&
      typeof value.provisionalExpertSection !== "boolean") ||
    (value.provisionalCharacterItemId !== undefined &&
      typeof value.provisionalCharacterItemId !== "string") ||
    !validDate(value.createdAt) ||
    !validDate(value.updatedAt)
  ) {
    return undefined;
  }
  const libraryTarget = parseStoredLibraryTarget(value.libraryTarget);
  const longWorldbuildingTarget = parseStoredLongWorldbuildingTarget(
    value.longWorldbuildingTarget
  );
  const longCharacterTarget = parseStoredLongCharacterTarget(
    value.longCharacterTarget
  );
  const longPlotDesignTarget = parseStoredLongPlotDesignTarget(
    value.longPlotDesignTarget
  );
  const longDraftTarget = parseStoredLongDraftTarget(value.longDraftTarget);
  const isLongFormProposal = Boolean(
    longWorldbuildingTarget ||
    longCharacterTarget ||
    longPlotDesignTarget ||
    longDraftTarget
  );
  if (
    (value.stageId === "library" && !libraryTarget) ||
    (value.stageId !== "library" && value.libraryTarget !== undefined) ||
    (value.stageId === "long-worldbuilding" && !longWorldbuildingTarget) ||
    (value.stageId !== "long-worldbuilding" &&
      value.longWorldbuildingTarget !== undefined) ||
    (value.stageId === "long-character" && !longCharacterTarget) ||
    (value.stageId !== "long-character" &&
      value.longCharacterTarget !== undefined) ||
    (value.stageId === "long-plot-design" && !longPlotDesignTarget) ||
    (value.stageId !== "long-plot-design" &&
      value.longPlotDesignTarget !== undefined) ||
    (value.stageId === "long-draft" && !longDraftTarget) ||
    (value.stageId !== "long-draft" && value.longDraftTarget !== undefined)
  ) {
    return undefined;
  }
  const draftSectionCreationTarget = parseStoredDraftSectionCreationTarget(
    value.draftSectionCreationTarget
  );
  if (
    value.draftSectionCreationTarget !== undefined &&
    !draftSectionCreationTarget
  ) {
    return undefined;
  }
  const draftSectionRenameTarget = parseStoredDraftSectionRenameTarget(
    value.draftSectionRenameTarget
  );
  if (
    value.draftSectionRenameTarget !== undefined &&
    !draftSectionRenameTarget
  ) {
    return undefined;
  }
  const draftSectionDeletionTarget = parseStoredDraftSectionDeletionTarget(
    value.draftSectionDeletionTarget
  );
  if (
    value.draftSectionDeletionTarget !== undefined &&
    !draftSectionDeletionTarget
  ) {
    return undefined;
  }
  const characterStructureTarget = parseStoredCharacterStructureTarget(
    value.characterStructureTarget
  );
  if (
    value.characterStructureTarget !== undefined &&
    !characterStructureTarget
  ) {
    return undefined;
  }
  const plotStructureTarget = parseStoredPlotStructureTarget(
    value.plotStructureTarget
  );
  if (value.plotStructureTarget !== undefined && !plotStructureTarget) {
    return undefined;
  }
  const hunks = value.hunks
    .map(parseStoredTextDiffHunk)
    .filter((hunk): hunk is AgentTextDiffHunk => hunk !== undefined);
  if (hunks.length !== value.hunks.length) return undefined;
  const discardSnapshot = parseStoredDiscardSnapshot(value.discardSnapshot);
  const discardState = parseStoredDiscardState(value.discardState);
  const statusMessage = isLongFormProposal
    ? value.status === "conflict"
      ? undefined
      : normalizeStoredLongProposalStatusMessage(value.statusMessage)
    : (value.statusMessage as string | undefined);
  if (
    !isLongFormProposal &&
    ((value.discardSnapshot !== undefined && !discardSnapshot) ||
      (value.discardState !== undefined && !discardState))
  ) {
    return undefined;
  }
  return {
    id: value.id,
    ...(value.laneId === undefined ? {} : { laneId: value.laneId }),
    ...(value.generation === undefined
      ? {}
      : { generation: value.generation as number }),
    ...(value.approvalMode === undefined
      ? {}
      : { approvalMode: value.approvalMode as AgentApprovalMode }),
    ...(value.predecessorProposalId === undefined
      ? {}
      : { predecessorProposalId: value.predecessorProposalId }),
    ...(!isLongFormProposal && typeof value.sourceBaseRevision === "string"
      ? { sourceBaseRevision: value.sourceBaseRevision }
      : {}),
    ...(value.decisionToken === undefined
      ? {}
      : { decisionToken: value.decisionToken }),
    runId: value.runId,
    workspaceId: value.workspaceId,
    stageId: value.stageId as AgentEditProposal["stageId"],
    documentId: value.documentId,
    title: value.title,
    summary: value.summary,
    status:
      value.status === "accepting" ||
      (isLongFormProposal && value.status === "conflict")
        ? "pending"
        : (value.status as AgentEditProposal["status"]),
    ...(!isLongFormProposal && typeof value.baseRevision === "string"
      ? { baseRevision: value.baseRevision }
      : {}),
    ...(!isLongFormProposal && typeof value.proposedRevision === "string"
      ? { proposedRevision: value.proposedRevision }
      : {}),
    ...(value.proposedText === undefined
      ? {}
      : { proposedText: value.proposedText }),
    toolCallIds: [...value.toolCallIds] as string[],
    additions: value.additions,
    deletions: value.deletions,
    hunks,
    ...(value.truncated === undefined ? {} : { truncated: value.truncated }),
    ...(statusMessage === undefined ? {} : { statusMessage }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(!isLongFormProposal && discardSnapshot ? { discardSnapshot } : {}),
    ...(!isLongFormProposal && discardState ? { discardState } : {}),
    ...(libraryTarget ? { libraryTarget } : {}),
    ...(longWorldbuildingTarget ? { longWorldbuildingTarget } : {}),
    ...(longCharacterTarget ? { longCharacterTarget } : {}),
    ...(longPlotDesignTarget ? { longPlotDesignTarget } : {}),
    ...(longDraftTarget ? { longDraftTarget } : {}),
    ...(draftSectionCreationTarget ? { draftSectionCreationTarget } : {}),
    ...(draftSectionRenameTarget ? { draftSectionRenameTarget } : {}),
    ...(draftSectionDeletionTarget ? { draftSectionDeletionTarget } : {}),
    ...(characterStructureTarget ? { characterStructureTarget } : {}),
    ...(plotStructureTarget ? { plotStructureTarget } : {}),
    ...(value.provisionalExpertSection
      ? { provisionalExpertSection: true }
      : {}),
    ...(typeof value.provisionalCharacterItemId === "string"
      ? { provisionalCharacterItemId: value.provisionalCharacterItemId }
      : {})
  };
}

function parseStoredRuntime(value: unknown): AgentRuntimeRef | undefined {
  if (
    !isRecord(value) ||
    typeof value.provider !== "string" ||
    !value.provider ||
    typeof value.model !== "string" ||
    !value.model ||
    (value.mode !== "local-faux" && value.mode !== "provider") ||
    (value.configId !== undefined &&
      (typeof value.configId !== "string" || !value.configId.trim()))
  ) {
    return undefined;
  }
  return {
    provider: value.provider,
    model: value.model,
    mode: value.mode,
    ...(typeof value.configId === "string" ? { configId: value.configId } : {})
  };
}

function parseStoredUsage(value: unknown): AgentUsage | undefined {
  if (!isRecord(value)) return undefined;
  const keys = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalTokens"
  ] as const;
  if (!keys.every((key) => nonnegativeInteger(value[key]))) return undefined;
  return {
    inputTokens: value.inputTokens as number,
    outputTokens: value.outputTokens as number,
    cacheReadTokens: value.cacheReadTokens as number,
    cacheWriteTokens: value.cacheWriteTokens as number,
    totalTokens: value.totalTokens as number
  };
}

function parseStoredToolTrace(value: unknown): AgentToolTrace | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !["preparing", "running", "completed", "error"].includes(
      String(value.status)
    ) ||
    typeof value.requestedAt !== "string"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    ...(typeof value.streamId === "string" ? { streamId: value.streamId } : {}),
    name: value.name,
    args: value.args,
    ...(typeof value.argumentsText === "string"
      ? { argumentsText: value.argumentsText }
      : {}),
    ...(typeof value.argumentsComplete === "boolean"
      ? { argumentsComplete: value.argumentsComplete }
      : {}),
    status: value.status as AgentToolTrace["status"],
    requestedAt: value.requestedAt,
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : {}),
    ...(typeof value.resultSummary === "string"
      ? { resultSummary: value.resultSummary }
      : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {})
  };
}

function parseStoredSubagentStep(
  value: unknown
): AgentSubagentProcessingStep | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return undefined;
  }
  if (value.type === "thinking" && typeof value.content === "string") {
    return {
      id: value.id,
      type: "thinking",
      content: value.content,
      createdAt: value.createdAt
    };
  }
  if (value.type === "response" && typeof value.content === "string") {
    return {
      id: value.id,
      type: "response",
      content: value.content,
      createdAt: value.createdAt
    };
  }
  if (value.type === "tool" && typeof value.toolCallId === "string") {
    return {
      id: value.id,
      type: "tool",
      toolCallId: value.toolCallId,
      createdAt: value.createdAt
    };
  }
  return undefined;
}

function parseStoredSubagentRun(value: unknown): AgentSubagentRun | undefined {
  if (
    !isRecord(value) ||
    typeof value.parentToolCallId !== "string" ||
    typeof value.subagentRunId !== "string" ||
    typeof value.subagentId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.task !== "string" ||
    !["running", "completed", "error", "stopped", "interrupted"].includes(
      String(value.status)
    ) ||
    !validDate(value.startedAt) ||
    !Array.isArray(value.toolCalls) ||
    !Array.isArray(value.processingSteps)
  ) {
    return undefined;
  }
  const runtime = parseStoredRuntime(value.runtime);
  if (!runtime) return undefined;
  const toolCalls = value.toolCalls
    .map(parseStoredToolTrace)
    .filter((toolCall): toolCall is AgentToolTrace => toolCall !== undefined);
  const processingSteps = value.processingSteps
    .map(parseStoredSubagentStep)
    .filter((step): step is AgentSubagentProcessingStep => step !== undefined);
  if (
    toolCalls.length !== value.toolCalls.length ||
    processingSteps.length !== value.processingSteps.length
  ) {
    return undefined;
  }

  const restoredWhileRunning = value.status === "running";
  const restoredAt = new Date().toISOString();
  const normalizedToolCalls = restoredWhileRunning
    ? toolCalls.map((toolCall) =>
        toolCall.status === "preparing" || toolCall.status === "running"
          ? {
              ...toolCall,
              status: "error" as const,
              completedAt: restoredAt,
              resultSummary:
                toolCall.resultSummary ?? "会话恢复时子任务已停止。",
              isError: true
            }
          : toolCall
      )
    : toolCalls;
  const usage = parseStoredUsage(value.usage);
  return {
    parentToolCallId: value.parentToolCallId,
    subagentRunId: value.subagentRunId,
    subagentId: value.subagentId,
    name: value.name,
    task: value.task,
    status:
      restoredWhileRunning || value.status === "interrupted"
        ? "stopped"
        : (value.status as AgentSubagentRun["status"]),
    runtime,
    ...(typeof value.thinking === "string" ? { thinking: value.thinking } : {}),
    ...(typeof value.output === "string" ? { output: value.output } : {}),
    toolCalls: normalizedToolCalls,
    processingSteps,
    startedAt: value.startedAt,
    ...(typeof value.completedAt === "string"
      ? { completedAt: value.completedAt }
      : restoredWhileRunning
        ? { completedAt: restoredAt }
        : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.errorMessage === "string"
      ? { errorMessage: value.errorMessage }
      : restoredWhileRunning
        ? { errorMessage: "应用关闭或对话恢复时，子任务仍在运行。" }
        : {}),
    ...(usage ? { usage } : {})
  };
}

export function parseStoredMessage(value: unknown): ChatMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    !validDate(value.createdAt)
  ) {
    return undefined;
  }

  const status = ["streaming", "completed", "stopped", "error"].includes(
    String(value.status)
  )
    ? (value.status as ChatMessage["status"])
    : undefined;
  const message: ChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    ...(status ? { status: status === "streaming" ? "stopped" : status } : {})
  };
  const runtime = parseStoredRuntime(value.runtime);
  const usage = parseStoredUsage(value.usage);
  if (runtime) message.runtime = runtime;
  if (usage) message.usage = usage;

  if (Array.isArray(value.attachments)) {
    message.attachments = value.attachments.flatMap((attachment) => {
      if (
        !isRecord(attachment) ||
        typeof attachment.id !== "string" ||
        typeof attachment.name !== "string" ||
        (attachment.kind !== "text" && attachment.kind !== "image") ||
        typeof attachment.mediaType !== "string" ||
        !nonnegativeInteger(attachment.size)
      ) {
        return [];
      }
      return [
        {
          id: attachment.id,
          name: attachment.name,
          kind: attachment.kind,
          mediaType: attachment.mediaType,
          size: attachment.size,
          ...(attachment.truncated === true ? { truncated: true } : {})
        }
      ];
    });
  }

  for (const key of [
    "runId",
    "thinking",
    "processingStartedAt",
    "processingCompletedAt",
    "errorMessage"
  ] as const) {
    if (typeof value[key] === "string") {
      message[key] = value[key];
    }
  }
  if (value.activityOnly === true) message.activityOnly = true;

  if (value.evaluationSnapshot !== undefined) {
    const parsedEvaluation = AgentEvaluationSnapshotSchema.safeParse(
      value.evaluationSnapshot
    );
    if (parsedEvaluation.success) {
      message.evaluationSnapshot = parsedEvaluation.data;
    }
  }

  if (Array.isArray(value.tools)) {
    message.tools = value.tools.flatMap((tool) => {
      if (
        !isRecord(tool) ||
        typeof tool.id !== "string" ||
        typeof tool.name !== "string" ||
        !["running", "completed", "error"].includes(String(tool.status))
      ) {
        return [];
      }
      return [
        {
          id: tool.id,
          name: tool.name,
          status: tool.status as "running" | "completed" | "error",
          ...(typeof tool.summary === "string" ? { summary: tool.summary } : {})
        }
      ];
    });
  }

  if (Array.isArray(value.toolCalls)) {
    message.toolCalls = value.toolCalls
      .map(parseStoredToolTrace)
      .filter((toolCall): toolCall is AgentToolTrace => toolCall !== undefined);
  }

  if (Array.isArray(value.processingSteps)) {
    const processingSteps: NonNullable<ChatMessage["processingSteps"]> = [];
    for (const step of value.processingSteps) {
      if (
        !isRecord(step) ||
        typeof step.id !== "string" ||
        typeof step.createdAt !== "string"
      ) {
        continue;
      }
      if (step.type === "thinking" && typeof step.content === "string") {
        processingSteps.push({
          id: step.id,
          type: "thinking",
          content: step.content,
          createdAt: step.createdAt
        });
        continue;
      }
      if (step.type === "response" && typeof step.content === "string") {
        processingSteps.push({
          id: step.id,
          type: "response",
          content: step.content,
          createdAt: step.createdAt
        });
        continue;
      }
      if (step.type === "tool" && typeof step.toolCallId === "string") {
        processingSteps.push({
          id: step.id,
          type: "tool",
          toolCallId: step.toolCallId,
          createdAt: step.createdAt
        });
      }
    }
    message.processingSteps = processingSteps;
  }

  if (Array.isArray(value.subagentRuns)) {
    message.subagentRuns = value.subagentRuns
      .map(parseStoredSubagentRun)
      .filter((run): run is AgentSubagentRun => run !== undefined);
  }

  if (Array.isArray(value.editProposals)) {
    const editProposals = value.editProposals
      .map(parseStoredEditProposal)
      .filter(
        (proposal): proposal is AgentEditProposal => proposal !== undefined
      );
    if (
      editProposals.length !== value.editProposals.length ||
      editProposals.some((proposal) => proposal.runId !== message.runId)
    ) {
      return undefined;
    }
    message.editProposals = editProposals;
  }

  if (
    message.status === "stopped" &&
    message.processingStartedAt &&
    !message.processingCompletedAt
  ) {
    message.processingCompletedAt = new Date().toISOString();
  }
  return message;
}
