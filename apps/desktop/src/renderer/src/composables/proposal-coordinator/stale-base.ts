import { createShortWorkspaceContentRevision } from "@deepwrite/contracts/renderer";
import { getErrorPayload } from "../../i18n/errors";
import type { AgentEditProposal } from "../../types/conversation";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";

type StaleBase = NonNullable<AgentEditProposal["staleBase"]>;

/**
 * How a full-text proposal may be written. Editing stays open while agents
 * run, so a target can change after the agent read it; such proposals wait
 * for the user to keep their version or overwrite it.
 */
export type TextProposalAcceptBase =
  | { kind: "ready"; overwrite: boolean }
  | { kind: "stale"; currentRevision: string };

/**
 * `liveContent` is the user's current text including unsaved drafts, or
 * undefined when the text is not loaded locally (Core then judges alone).
 * `agentWrittenRevision` is the text the latest accepted agent write left in
 * the document: a sibling subagent's edit explains a moved base, so full-text
 * writes keep their last-writer-wins order unless the user edited after it.
 */
export function resolveTextProposalAcceptBase(
  proposal: Pick<AgentEditProposal, "baseRevision" | "staleBase">,
  liveContent: string | undefined,
  agentWrittenRevision?: string
): TextProposalAcceptBase {
  const confirmed = proposal.staleBase?.currentRevision;
  if (liveContent === undefined) {
    return { kind: "ready", overwrite: confirmed !== undefined };
  }
  const currentRevision = createShortWorkspaceContentRevision(liveContent);
  if (
    currentRevision === proposal.baseRevision ||
    currentRevision === agentWrittenRevision
  ) {
    return { kind: "ready", overwrite: false };
  }
  if (currentRevision === confirmed) return { kind: "ready", overwrite: true };
  return { kind: "stale", currentRevision };
}

/**
 * Revision Core must find on disk: the text this window last saw there.
 * Unloaded text carries no user edits, so Core writes it unchecked as before.
 */
export function expectedDiskRevision(
  diskContent: string | undefined
): string | undefined {
  return diskContent === undefined
    ? undefined
    : createShortWorkspaceContentRevision(diskContent);
}

/**
 * Revision to record after Core rejected a write: the reloaded text when it
 * moved past the agent's base, otherwise the revision Core found on disk.
 */
export function staleRevisionAfterConflict(
  error: unknown,
  latestContent: string | undefined,
  proposal: Pick<AgentEditProposal, "baseRevision">
): string {
  const latest =
    latestContent === undefined
      ? undefined
      : createShortWorkspaceContentRevision(latestContent);
  if (latest !== undefined && latest !== proposal.baseRevision) return latest;
  const actual = getErrorPayload(error)?.details?.actualRevision;
  return typeof actual === "string"
    ? actual
    : (latest ?? proposal.baseRevision ?? "");
}

/** Staleness detected while staging; keeps the first detection time. */
export function stagedStaleBase(
  existing: Pick<AgentEditProposal, "staleBase"> | undefined,
  liveContent: string,
  baseRevision: string,
  detectedAt: string,
  agentWrittenRevision?: string
): StaleBase | undefined {
  const currentRevision = createShortWorkspaceContentRevision(liveContent);
  if (
    currentRevision === baseRevision ||
    currentRevision === agentWrittenRevision
  ) {
    return undefined;
  }
  return {
    detectedAt: existing?.staleBase?.detectedAt ?? detectedAt,
    currentRevision
  };
}

/**
 * Holds a stale proposal for an explicit user decision (the card explains
 * it). The diff is rebuilt against the current text so the card shows what
 * overwriting would change.
 */
export function staleTextProposalPatch(
  proposal: Pick<AgentEditProposal, "proposedText" | "staleBase">,
  liveContent: string | undefined,
  currentRevision: string,
  detectedAt = new Date().toISOString()
): Partial<AgentEditProposal> {
  const diff =
    liveContent === undefined || proposal.proposedText === undefined
      ? undefined
      : buildAgentTextDiff(liveContent, proposal.proposedText);
  return {
    status: "pending",
    approvalMode: "request-approval",
    staleBase: {
      detectedAt: proposal.staleBase?.detectedAt ?? detectedAt,
      currentRevision
    },
    ...(diff
      ? {
          additions: diff.additions,
          deletions: diff.deletions,
          hunks: diff.hunks,
          truncated: Boolean(diff.truncated)
        }
      : {})
  };
}

/** Records how the user settled a stale proposal, for the agent's next turn. */
export function resolvedStaleBase(
  proposal: Pick<AgentEditProposal, "staleBase">,
  resolution: NonNullable<StaleBase["resolution"]>
): Partial<AgentEditProposal> {
  return proposal.staleBase
    ? { staleBase: { ...proposal.staleBase, resolution } }
    : {};
}
