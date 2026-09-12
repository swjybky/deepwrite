import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  appendWritingContentCounts,
  type WritingContentTarget
} from "../writing-content-counts";
import { longFileContentTargets } from "./content-counts";
import {
  LONG_CHARACTER_OVERVIEW_CHANGE_ID,
  LongWorkspaceOperationBatchSchema,
  type LongChapterBodyChange,
  type LongCharacterFileChange,
  type LongContinuityFileChange,
  type LongContinuityFileRole,
  type LongWorkspaceFileReference,
  type LongWorkspaceOperation,
  type LongWorldbuildingFileChange
} from "@deepwrite/contracts";
import {
  preflightLongMutationProposal,
  stableHash,
  textResult
} from "./shared";
import { longProposalResultSummary, type LongToolContext } from "./context";
import type { LongDocumentTarget } from "./target";
import type { LongChapterDocumentKey } from "./entity-registry";
import type { LongAgentToolDetails } from "./index";

export type LongFileOperation = "create" | "write" | "edit";

const CONTINUITY_ROLES: Partial<
  Record<LongChapterDocumentKey, LongContinuityFileRole>
> = {
  character_state: "chapter_end_state",
  handoff: "handoff",
  foreshadowing_changes: "foreshadowing_changes",
  world_reveals: "world_reveals",
  continuity_character_current_state: "character_current_state",
  continuity_character_history: "character_history"
};

export function longContinuityRole(
  document: LongChapterDocumentKey
): LongContinuityFileRole | undefined {
  return CONTINUITY_ROLES[document];
}

export function proposalId(
  ctx: LongToolContext,
  toolCallId: string,
  discriminator: string
): string {
  return `proposal_${stableHash(
    `${ctx.workspace.bookId}:${ctx.input.runId}:${toolCallId}:${discriminator}`
  ).slice(0, 24)}`;
}

export interface LongFileChangeInput {
  target: LongDocumentTarget;
  operation: LongFileOperation;
  beforeText: string;
  afterText: string;
  file: LongWorkspaceFileReference;
}

type RoutedChange =
  | { route: "worldbuilding"; change: LongWorldbuildingFileChange }
  | { route: "character"; change: LongCharacterFileChange }
  | { route: "continuity"; change: LongContinuityFileChange }
  | { route: "chapter_body"; change: LongChapterBodyChange }
  | { route: "mutation" };

function routeChange(input: LongFileChangeInput): RoutedChange {
  const { target } = input;
  const shared = {
    fileId: input.file.id,
    filePath: input.file.path,
    operation: input.operation,
    beforeText: input.beforeText,
    afterText: input.afterText
  };

  if (target.stage === "worldbuilding") {
    return {
      route: "worldbuilding",
      change: {
        categoryId: target.categoryId!,
        ...(target.itemId ? { itemId: target.itemId } : {}),
        title: target.title,
        ...shared
      } satisfies LongWorldbuildingFileChange
    };
  }
  if (target.kind === "character_overview") {
    return {
      route: "character",
      change: {
        characterId: LONG_CHARACTER_OVERVIEW_CHANGE_ID,
        characterName: "人物概览",
        document: "overview",
        title: target.title,
        ...shared
      } satisfies LongCharacterFileChange
    };
  }
  if (target.kind === "character") {
    return {
      route: "character",
      change: {
        characterId: target.id,
        characterName: target.characterName!,
        document: target.document! as LongCharacterFileChange["document"],
        title: target.title,
        ...shared
      } satisfies LongCharacterFileChange
    };
  }
  if (target.kind === "chapter_card" && target.document === "body") {
    return {
      route: "chapter_body",
      change: {
        chapterCardId: target.id,
        chapterTitle: target.chapterTitle!,
        ...shared
      } satisfies LongChapterBodyChange
    };
  }
  const role =
    target.kind === "chapter_card" && target.document
      ? longContinuityRole(target.document as LongChapterDocumentKey)
      : undefined;
  if (role) {
    return {
      route: "continuity",
      change: {
        chapterCardId: target.id,
        role,
        characterId: target.characterId ?? null,
        title: target.title,
        ...shared
      } satisfies LongContinuityFileChange
    };
  }
  return { route: "mutation" };
}

export interface LongProposalInput {
  toolCallId: string;
  changes: readonly LongFileChangeInput[];
  operations: readonly LongWorkspaceOperation[];
  timestamp: string;
  summary: string;
  message: string;
  contentTargets?: readonly WritingContentTarget[];
  index: Parameters<typeof preflightLongMutationProposal>[0];
}

/**
 * Routes a set of file changes to the matching proposal event. Each proposal
 * carries exactly one route so the client keeps rendering a single review card
 * shape per tool call.
 */
export function formLongProposal(
  ctx: LongToolContext,
  input: LongProposalInput
): AgentToolResult<LongAgentToolDetails> {
  const routed = input.changes.map(routeChange);
  const routes = new Set(routed.map(({ route }) => route));
  if (routes.size > 1) {
    throw new Error("A long proposal may only target one stage at a time.");
  }
  const batch = LongWorkspaceOperationBatchSchema.parse({
    updatedAt: input.timestamp,
    operations: input.operations,
    documentWrites: input.changes.map((change, changeIndex) => ({
      proposalId: proposalId(ctx, input.toolCallId, `write:${changeIndex}`),
      fileId: change.file.id,
      content: change.afterText,
      mode:
        change.operation === "create"
          ? ("create" as const)
          : ("replace" as const),
      updatedAt: input.timestamp,
      reason: input.summary
    }))
  });
  const preflightFailure = preflightLongMutationProposal(input.index, batch);
  if (preflightFailure) return preflightFailure;
  ctx.rememberProposal({
    operations: input.operations,
    changes: input.changes,
    timestamp: input.timestamp
  });

  const message = appendWritingContentCounts(
    longProposalResultSummary(ctx.input, input.message),
    input.contentTargets ?? longFileContentTargets(input.changes)
  );
  const base = {
    bookId: ctx.workspace.bookId,
    agentId: ctx.profile.id,
    batch,
    summary: input.summary
  };
  const route = routed[0]?.route ?? "mutation";
  if (route === "worldbuilding") {
    return textResult(message, {
      kind: "long-worldbuilding-file-proposal",
      ...base,
      files: routed.map(
        (entry) => (entry as { change: LongWorldbuildingFileChange }).change
      )
    });
  }
  if (route === "character") {
    return textResult(message, {
      kind: "long-character-file-proposal",
      ...base,
      files: routed.map(
        (entry) => (entry as { change: LongCharacterFileChange }).change
      )
    });
  }
  if (route === "continuity") {
    return textResult(message, {
      kind: "long-continuity-file-proposal",
      ...base,
      files: routed.map(
        (entry) => (entry as { change: LongContinuityFileChange }).change
      )
    });
  }
  if (route === "chapter_body") {
    return textResult(message, {
      kind: "long-chapter-write-proposal",
      ...base,
      file: (routed[0] as { change: LongChapterBodyChange }).change
    });
  }
  return textResult(message, { kind: "long-mutation-proposal", ...base });
}
