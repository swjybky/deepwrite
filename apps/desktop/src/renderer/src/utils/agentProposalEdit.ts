import {
  createShortWorkspaceContentRevision,
  parseLongForeshadowingBody,
  serializeLongForeshadowingBody,
  WRITE_APPROVAL_EDITED_TEXT_MAX_LENGTH
} from "@deepwrite/contracts/renderer";
import type {
  LongWorkspaceOperation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type {
  AgentEditProposal,
  AgentTextDiffHunk
} from "../types/conversation";
import { buildAgentTextDiff } from "./agentTextDiff";

function splitLines(value: string): string[] {
  return value
    ? value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")
    : [];
}

/** Undoes the diff hunks on the proposed text; checked by diffing again. */
function reconstructBaseText(
  proposedText: string,
  hunks: readonly AgentTextDiffHunk[]
): string | undefined {
  const lines = splitLines(proposedText);
  for (const hunk of [...hunks].reverse()) {
    const start = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
    if (start < 0 || start + hunk.newLines > lines.length) return undefined;
    lines.splice(
      start,
      hunk.newLines,
      ...hunk.lines
        .filter((line) => line.type !== "addition")
        .map((line) => line.text)
    );
  }
  const base = lines.join("\n");
  const check = buildAgentTextDiff(base, proposedText);
  return JSON.stringify(check.hunks) === JSON.stringify(hunks)
    ? base
    : undefined;
}

/** The single replaced document of a long-form batch, if editing can swap it. */
function longDocumentWrite(
  batch: LongWorkspaceOperationBatch,
  fileId: string
): LongWorkspaceOperationBatch["documentWrites"][number] | undefined {
  const write = batch.documentWrites.find((item) => item.fileId === fileId);
  return write && write.mode !== "append" ? write : undefined;
}

function isEditableIndexProseOperation(
  operation: LongWorkspaceOperation
): boolean {
  switch (operation.type) {
    case "volume.create":
    case "volume.update":
    case "arc.create":
    case "arc.update":
    case "event.create":
    case "event.update":
    case "connection.create":
    case "connection.update":
    case "placement.create":
    case "placement.update":
    case "foreshadowing.create":
    case "foreshadowing.update":
    case "foreshadowingBeat.create":
    case "foreshadowingBeat.update":
      return true;
    default:
      return false;
  }
}

function withEditedIndexOperationProse(
  operation: LongWorkspaceOperation,
  text: string
): { operation: LongWorkspaceOperation; afterText: string } {
  switch (operation.type) {
    case "volume.create":
      return {
        operation: {
          ...operation,
          volume: { ...operation.volume, summary: text }
        },
        afterText: text
      };
    case "volume.update":
      return {
        operation: {
          ...operation,
          patch: { ...operation.patch, summary: text }
        },
        afterText: text
      };
    case "arc.create":
      return {
        operation: { ...operation, arc: { ...operation.arc, summary: text } },
        afterText: text
      };
    case "arc.update":
      return {
        operation: {
          ...operation,
          patch: { ...operation.patch, summary: text }
        },
        afterText: text
      };
    case "event.create":
      return {
        operation: {
          ...operation,
          event: { ...operation.event, summary: text }
        },
        afterText: text
      };
    case "event.update":
      return {
        operation: {
          ...operation,
          patch: { ...operation.patch, summary: text }
        },
        afterText: text
      };
    case "connection.create":
      return {
        operation: {
          ...operation,
          connection: { ...operation.connection, note: text }
        },
        afterText: text
      };
    case "connection.update":
      return {
        operation: { ...operation, patch: { ...operation.patch, note: text } },
        afterText: text
      };
    case "placement.create":
      return {
        operation: {
          ...operation,
          placement: { ...operation.placement, writingPrompt: text }
        },
        afterText: text
      };
    case "placement.update":
      return {
        operation: {
          ...operation,
          patch: { ...operation.patch, writingPrompt: text }
        },
        afterText: text
      };
    case "foreshadowing.create": {
      const parsed = parseLongForeshadowingBody(text);
      return {
        operation: {
          ...operation,
          thread: { ...operation.thread, ...parsed }
        },
        afterText: serializeLongForeshadowingBody(parsed)
      };
    }
    case "foreshadowing.update": {
      const parsed = parseLongForeshadowingBody(text);
      return {
        operation: {
          ...operation,
          patch: { ...operation.patch, ...parsed }
        },
        afterText: serializeLongForeshadowingBody(parsed)
      };
    }
    case "foreshadowingBeat.create":
      return {
        operation: { ...operation, beat: { ...operation.beat, note: text } },
        afterText: text
      };
    case "foreshadowingBeat.update":
      return {
        operation: { ...operation, patch: { ...operation.patch, note: text } },
        afterText: text
      };
    default:
      return { operation, afterText: text };
  }
}

function longEditTarget(
  proposal: AgentEditProposal
): { beforeText: string } | undefined {
  const draft = proposal.longDraftTarget;
  if (draft) return draft.file;
  const world = proposal.longWorldbuildingTarget;
  if (world)
    return longDocumentWrite(world.batch, world.file.fileId) && world.file;
  const character = proposal.longCharacterTarget;
  if (character?.files.length === 1) {
    const file = character.files[0]!;
    return longDocumentWrite(character.batch, file.fileId) && file;
  }
  const plot = proposal.longPlotDesignTarget;
  const content = plot?.review?.content;
  if (!plot || !content) return undefined;
  if (
    content.fileId &&
    plot.batch.documentWrites.length === 1 &&
    longDocumentWrite(plot.batch, content.fileId)
  ) {
    return content;
  }
  if (
    plot.batch.documentWrites.length === 0 &&
    plot.batch.operations.length === 1 &&
    isEditableIndexProseOperation(plot.batch.operations[0]!)
  ) {
    return content;
  }
  return undefined;
}

/**
 * Text the proposal's diff starts from, when the user may rewrite the
 * proposed text on its card. Structure changes are only accepted or rejected.
 */
export function proposalEditBaseText(
  proposal: AgentEditProposal
): string | undefined {
  if (
    proposal.status !== "pending" ||
    proposal.approvalMode === "auto-approve" ||
    typeof proposal.proposedText !== "string" ||
    proposal.libraryStructureTarget ||
    proposal.characterStructureTarget ||
    proposal.plotStructureTarget ||
    proposal.draftSectionCreationTarget ||
    proposal.draftSectionRenameTarget ||
    proposal.draftSectionDeletionTarget
  ) {
    return undefined;
  }
  const long = longEditTarget(proposal);
  if (long) return long.beforeText;
  if (
    proposal.longDraftTarget ||
    proposal.longWorldbuildingTarget ||
    proposal.longCharacterTarget ||
    proposal.longPlotDesignTarget ||
    proposal.truncated
  ) {
    return undefined;
  }
  return reconstructBaseText(proposal.proposedText, proposal.hunks);
}

function withEditedWrite(
  batch: LongWorkspaceOperationBatch,
  fileId: string,
  text: string
): LongWorkspaceOperationBatch {
  return {
    ...batch,
    documentWrites: batch.documentWrites.map((write) =>
      write.fileId === fileId ? { ...write, content: text } : write
    )
  };
}

/** Long-form targets carry the text in their batch; impact is re-checked. */
function editedLongTargets(
  proposal: AgentEditProposal,
  text: string
): Partial<AgentEditProposal> {
  const draft = proposal.longDraftTarget;
  if (draft) {
    const { expectedImpact: _impact, ...target } = draft;
    return {
      longDraftTarget: {
        ...target,
        batch: withEditedWrite(draft.batch, draft.file.fileId, text),
        file: { ...draft.file, afterText: text }
      }
    };
  }
  const world = proposal.longWorldbuildingTarget;
  if (world) {
    const { expectedImpact: _impact, ...target } = world;
    return {
      longWorldbuildingTarget: {
        ...target,
        batch: withEditedWrite(world.batch, world.file.fileId, text),
        file: { ...world.file, afterText: text }
      }
    };
  }
  const character = proposal.longCharacterTarget;
  if (character) {
    const { expectedImpact: _impact, ...target } = character;
    const file = character.files[0]!;
    return {
      longCharacterTarget: {
        ...target,
        batch: withEditedWrite(character.batch, file.fileId, text),
        files: [{ ...file, afterText: text }]
      }
    };
  }
  const plot = proposal.longPlotDesignTarget;
  if (plot?.review?.content) {
    const { expectedImpact: _impact, ...target } = plot;
    const content = plot.review.content;
    if (content.fileId) {
      return {
        longPlotDesignTarget: {
          ...target,
          batch: withEditedWrite(plot.batch, content.fileId, text),
          review: {
            ...plot.review,
            content: { ...content, afterText: text }
          }
        }
      };
    }
    const edited = withEditedIndexOperationProse(
      plot.batch.operations[0]!,
      text
    );
    return {
      longPlotDesignTarget: {
        ...target,
        batch: {
          ...plot.batch,
          operations: [edited.operation]
        },
        review: {
          ...plot.review,
          content: { ...content, afterText: edited.afterText }
        }
      }
    };
  }
  return {};
}

/**
 * Turns a pending proposal into the user's version before it is accepted
 * through the normal path. Undefined when the proposal cannot be edited.
 */
export function editedProposalPatch(
  proposal: AgentEditProposal,
  text: string
): Partial<AgentEditProposal> | undefined {
  const base = proposalEditBaseText(proposal);
  if (base === undefined) return undefined;
  const diff = buildAgentTextDiff(base, text);
  return {
    proposedText: text,
    ...(proposal.proposedRevision === undefined
      ? {}
      : { proposedRevision: createShortWorkspaceContentRevision(text) }),
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    truncated: diff.truncated,
    userEditedText: text.slice(0, WRITE_APPROVAL_EDITED_TEXT_MAX_LENGTH),
    ...(text.length > WRITE_APPROVAL_EDITED_TEXT_MAX_LENGTH
      ? { userEditedTextTruncated: true }
      : {}),
    ...editedLongTargets(proposal, text)
  };
}
