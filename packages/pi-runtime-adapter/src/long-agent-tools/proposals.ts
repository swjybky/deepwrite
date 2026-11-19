import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  appendWritingContentCounts,
  type WritingContentTarget
} from "../writing-content-counts";
import { longFileContentTargets } from "./content-counts";
import {
  LONG_CHARACTER_OVERVIEW_CHANGE_ID,
  LongMutationReviewSchema,
  LongWorkspaceOperationBatchSchema,
  type LongChapterBodyChange,
  type LongCharacterFileChange,
  type LongContinuityFileChange,
  type LongContinuityFileRole,
  type LongMutationReview,
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
  review?: LongMutationReview;
  index: Parameters<typeof preflightLongMutationProposal>[0];
  remember?: boolean;
}

function mutationReviewFromDocumentChange(
  change: LongFileChangeInput
): LongMutationReview {
  const { target, file, operation, beforeText, afterText } = change;
  const isCreate = operation === "create";
  const targetKey = isCreate ? `create:${target.id}` : `doc:${file.id}`;
  let title = target.title;
  if (target.kind === "chapter_card" && target.document === "card") {
    title = isCreate
      ? `新建章卡 · ${target.chapterTitle ?? target.title}`
      : target.title;
  } else if (target.kind === "book_line") {
    title = "全书故事线";
  } else if (target.kind === "story_plot") {
    title = isCreate
      ? `新建故事情节 · ${target.title}`
      : `故事情节 · ${target.title}`;
  }
  const hasContent = !isCreate || afterText.length > 0;
  return LongMutationReviewSchema.parse({
    targetKey,
    targetKind: target.kind,
    targetId: target.id,
    action: isCreate ? "create" : "edit",
    title: title.slice(0, 600),
    ...(hasContent
      ? {
          content: {
            fileId: file.id,
            filePath: file.path,
            operation,
            beforeText,
            afterText
          }
        }
      : {})
  });
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
      updatedAt: input.timestamp,
      reason: input.summary,
      ...(change.operation === "create"
        ? { mode: "create" as const }
        : {
            mode: "replace" as const,
            // Users may edit while the agent runs; Core rejects the write if
            // this file no longer holds the text the agent edited.
            expectedSha256: stableHash(change.beforeText)
          })
    }))
  });
  const preflightFailure = preflightLongMutationProposal(input.index, batch);
  if (preflightFailure) return preflightFailure;
  if (input.remember !== false)
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
  const review =
    input.review !== undefined
      ? LongMutationReviewSchema.parse(input.review)
      : input.changes.length === 1
        ? mutationReviewFromDocumentChange(input.changes[0]!)
        : undefined;
  return textResult(message, {
    kind: "long-mutation-proposal",
    ...base,
    ...(review ? { review } : {})
  });
}
