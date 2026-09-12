import type {
  AgentApprovalMode,
  AgentEditProposal,
  AgentTextDiffHunk
} from "../../types/conversation";
import { isRecord, nonnegativeInteger, validDate } from "./shared";
import {
  parseStoredDiscardSnapshot,
  parseStoredDiscardState
} from "../../utils/acceptedEditDiscardPersistence";
import {
  isStoredLongProposalCandidate,
  normalizeStoredLongProposalStatusMessage
} from "./long-proposal-persistence-compatibility";
import { parseStoredLibraryTarget } from "./library-target";
import { parseStoredTextDiffHunk } from "./parse-diff";
import {
  parseStoredDraftSectionCreationTarget,
  parseStoredDraftSectionRenameTarget,
  parseStoredDraftSectionDeletionTarget
} from "./parse-draft-targets";
import {
  parseStoredCharacterStructureTarget,
  parseStoredPlotStructureTarget
} from "./parse-structure-targets";
import {
  parseStoredLongWorldbuildingTarget,
  parseStoredLongCharacterTarget,
  parseStoredLongPlotDesignTarget,
  parseStoredLongDraftTarget
} from "./parse-long-targets";
export function parseStoredEditProposal(
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
