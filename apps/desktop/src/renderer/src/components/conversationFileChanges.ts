import type { AgentEditProposal } from "../types/conversation";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { agentEditProposalLaneId } from "../utils/agentEditReview";
import type { ApprovalCardItem } from "./conversationToolPresentation";
import {
  isStaleProposal,
  proposalDiscardState
} from "./agentEditProposalPresentation";
import {
  canDisplayContentFileDiff,
  contentProposalDiffStats,
  isContentFileProposalItem,
  longContentFileDiffs
} from "./longProposalPresentation";

/**
 * `action`: the user has to decide (review, conflict, failure, edited target).
 * `progress`: settling on its own (saving, autosave queue, validation).
 * `remote`: decided on the device that made it; read-only here.
 */
export type FileChangeRowStatus =
  "action" | "progress" | "remote" | "accepted" | "rejected" | "discarded";

export interface FileChangeRow {
  key: string;
  kind: "text" | "structure" | "ledger";
  /** Every write to this target in the turn, oldest first; the last is current. */
  writes: ApprovalCardItem[];
  fileCount: number;
  /** Absent for structure changes and diffs that cannot be shown yet. */
  additions?: number;
  deletions?: number;
  creates: boolean;
  deletes: boolean;
  status: FileChangeRowStatus;
  /** An `action` caused by a failure or conflict rather than a plain review. */
  danger: boolean;
}

export interface FileChangeSummary {
  rows: FileChangeRow[];
  fileCount: number;
  /** No row edits file text, so the header counts changes instead of files. */
  structureOnly: boolean;
  additions: number;
  deletions: number;
  counts: Record<FileChangeRowStatus, number>;
  danger: boolean;
}

/** Long lists show a preview of this many rows… */
export const FILE_CHANGE_PREVIEW_ROWS = 6;
/** …once they grow past this many rows and nothing needs the user. */
export const FILE_CHANGE_COLLAPSE_THRESHOLD = 8;

type RowState = Pick<FileChangeRow, "status" | "danger">;

const ACTION: RowState = { status: "action", danger: false };
const DANGER: RowState = { status: "action", danger: true };
const PROGRESS: RowState = { status: "progress", danger: false };

function editRowState(
  proposal: AgentEditProposal,
  remoteDevice: string | undefined
): RowState {
  if (remoteDevice) {
    return proposal.status === "accepted" || proposal.status === "rejected"
      ? { status: proposal.status, danger: false }
      : { status: "remote", danger: false };
  }
  const discard = proposalDiscardState(proposal);
  if (discard?.status === "discarding") return PROGRESS;
  if (discard?.status === "discarded") {
    return { status: "discarded", danger: false };
  }
  if (discard) return DANGER;
  if (isStaleProposal(proposal)) return DANGER;
  switch (proposal.status) {
    case "pending":
      return proposal.approvalMode === "auto-approve" ? PROGRESS : ACTION;
    case "accepting":
      return PROGRESS;
    case "accepted":
    case "rejected":
      return { status: proposal.status, danger: false };
    default:
      return DANGER;
  }
}

function longRowState(item: LongWorkspaceProposalItem): RowState {
  if (item.status === "accepted") return { status: "accepted", danger: false };
  if (item.status === "error") return DANGER;
  if (item.status === "waiting" && item.blockedByError) return DANGER;
  if (item.status === "ready" && item.approvalMode !== "auto-approve") {
    return ACTION;
  }
  return PROGRESS;
}

function isStructureEdit(proposal: AgentEditProposal): boolean {
  return Boolean(
    proposal.draftSectionCreationTarget ||
    proposal.draftSectionRenameTarget ||
    proposal.draftSectionDeletionTarget ||
    proposal.plotStructureTarget ||
    proposal.characterStructureTarget
  );
}

function editCreates(proposal: AgentEditProposal): boolean {
  return (
    proposal.libraryTarget?.operation === "create" ||
    Boolean(proposal.draftSectionCreationTarget) ||
    proposal.plotStructureTarget?.mutation.type === "create" ||
    proposal.characterStructureTarget?.mutation.type === "createItem" ||
    proposal.longWorldbuildingTarget?.file.operation === "create" ||
    (proposal.longCharacterTarget?.files.every(
      ({ operation }) => operation === "create"
    ) ??
      false)
  );
}

function editDeletes(proposal: AgentEditProposal): boolean {
  return (
    Boolean(proposal.draftSectionDeletionTarget) ||
    proposal.characterStructureTarget?.mutation.type === "deleteItem"
  );
}

function rowKey(item: ApprovalCardItem): string {
  if (item.type === "long-proposal") return `long:${item.item.event.id}`;
  if (item.remoteDevice) return `remote:${item.proposal.id}`;
  return `edit:${agentEditProposalLaneId(item.proposal)}`;
}

function editRow(key: string, writes: ApprovalCardItem[]): FileChangeRow {
  const edits = writes as Extract<
    ApprovalCardItem,
    { type: "edit-proposal" }
  >[];
  const latest = edits.at(-1)!;
  const proposal = latest.proposal;
  const structure = isStructureEdit(proposal);
  const additions = edits.reduce(
    (sum, edit) => sum + edit.proposal.additions,
    0
  );
  const deletions = edits.reduce(
    (sum, edit) => sum + edit.proposal.deletions,
    0
  );
  const hasStats = !structure || additions + deletions > 0;
  const latestState = editRowState(proposal, latest.remoteDevice);
  const states = edits.map(({ proposal: write, remoteDevice }) =>
    editRowState(write, remoteDevice)
  );
  // A later auto-approved write may wait on an earlier manual review. Keep
  // unresolved work visible instead of letting the latest generation hide it.
  const state =
    states.find(({ status }) => status === "action") ??
    states.find(({ status }) => status === "progress") ??
    latestState;
  return {
    key,
    kind: structure ? "structure" : "text",
    writes,
    fileCount: proposal.draftSectionCreationTarget?.sections.length ?? 1,
    ...(hasStats ? { additions, deletions } : {}),
    creates: edits.some(({ proposal: write }) => editCreates(write)),
    deletes: editDeletes(proposal),
    ...state,
    danger: states.some(({ danger }) => danger)
  };
}

function longRow(key: string, write: ApprovalCardItem): FileChangeRow {
  const item = (write as Extract<ApprovalCardItem, { type: "long-proposal" }>)
    .item;
  const content = isContentFileProposalItem(item);
  const stats =
    content && canDisplayContentFileDiff(item)
      ? contentProposalDiffStats(item)
      : undefined;
  const files = longContentFileDiffs(item).map(({ file }) => file);
  return {
    key,
    kind:
      item.event.type === "long.ledger_commit_proposal"
        ? "ledger"
        : content
          ? "text"
          : "structure",
    writes: [write],
    fileCount: Math.max(1, files.length),
    ...(stats
      ? { additions: stats.additions, deletions: stats.deletions }
      : {}),
    creates:
      files.length > 0 &&
      files.every(({ operation }) => operation === "create"),
    deletes: false,
    ...longRowState(item)
  };
}

/** One row per changed target, ordered by its first write in the turn. */
export function fileChangeSummary(
  approvals: readonly ApprovalCardItem[]
): FileChangeSummary {
  const groups = new Map<string, ApprovalCardItem[]>();
  for (const approval of approvals) {
    const key = rowKey(approval);
    const group = groups.get(key);
    if (group) group.push(approval);
    else groups.set(key, [approval]);
  }
  const rows = [...groups].map(([key, writes]) => {
    if (writes[0]!.type === "long-proposal") return longRow(key, writes[0]!);
    const ordered = [...writes].sort(
      (left, right) =>
        ((left as { proposal: AgentEditProposal }).proposal.generation ?? 1) -
        ((right as { proposal: AgentEditProposal }).proposal.generation ?? 1)
    );
    return editRow(key, ordered);
  });
  const counts: Record<FileChangeRowStatus, number> = {
    action: 0,
    progress: 0,
    remote: 0,
    accepted: 0,
    rejected: 0,
    discarded: 0
  };
  for (const row of rows) counts[row.status] += 1;
  return {
    rows,
    fileCount: rows.reduce((sum, row) => sum + row.fileCount, 0),
    structureOnly: rows.every((row) => row.kind !== "text"),
    additions: rows.reduce((sum, row) => sum + (row.additions ?? 0), 0),
    deletions: rows.reduce((sum, row) => sum + (row.deletions ?? 0), 0),
    counts,
    danger: rows.some((row) => row.danger)
  };
}

/** Rows shown before “N more”; anything awaiting the user is never hidden. */
export function visibleFileChangeRows(
  summary: FileChangeSummary,
  showAll: boolean
): FileChangeRow[] {
  if (
    showAll ||
    summary.counts.action > 0 ||
    summary.rows.length <= FILE_CHANGE_COLLAPSE_THRESHOLD
  ) {
    return summary.rows;
  }
  return summary.rows.slice(0, FILE_CHANGE_PREVIEW_ROWS);
}
