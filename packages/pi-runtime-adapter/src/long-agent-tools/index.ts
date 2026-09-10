import type { MaterialQueryRunner } from "../material-query-runtime";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  AgentWriteApprovalMode,
  CommandResult,
  LongAgentProfile,
  LongChapterBodyChange,
  LongCharacterFileChange,
  LongCommitChapterInput,
  LongContinuityFileChange,
  LongWorkspaceCommandEnvelope,
  LongWorkspaceOperationBatch,
  LongWorkspaceRuntimeContext,
  LongWorldbuildingFileChange,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { createLongToolContext } from "./context";
import {
  buildLoadSkillTool,
  buildQueryLinkedMaterialEntriesTool
} from "./catalog-tools";
import { buildListTool } from "./tool-list";
import { buildReadTool } from "./tool-read";
import { buildCreateTool } from "./tool-create";
import { buildEditTool } from "./tool-edit";
import { buildDeleteTool } from "./tool-delete";
import { buildLedgerCommitTool } from "./ledger-tools";
import { buildAskUserQuestionTool } from "./tool-ask-user-question";
import type { AgentUserInputRequester } from "../runtime-types";
import type { LongWorkspaceToolSharedState } from "./proposal-overlay";

export type LongQueryCommandEnvelope = Extract<
  LongWorkspaceCommandEnvelope,
  {
    type: "long.getWorkspaceIndex" | "long.readDocument" | "long.search";
  }
>;

export type LongCommandExecutor = (
  command: LongQueryCommandEnvelope,
  signal?: AbortSignal
) => Promise<CommandResult>;

export type LongAgentToolDetails =
  | { kind: "none" }
  | {
      kind: "long-mutation-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
    }
  | {
      kind: "long-worldbuilding-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
      files: LongWorldbuildingFileChange[];
    }
  | {
      kind: "long-character-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
      files: LongCharacterFileChange[];
    }
  | {
      kind: "long-continuity-file-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      summary: string;
      files: LongContinuityFileChange[];
    }
  | {
      kind: "long-chapter-write-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      batch: LongWorkspaceOperationBatch;
      file: LongChapterBodyChange;
      summary: string;
    }
  | {
      kind: "long-ledger-commit-proposal";
      bookId: string;
      agentId: LongAgentProfile["id"];
      input: LongCommitChapterInput;
      summary: string;
    };

export interface BuildLongWorkspaceToolsInput {
  workspace: LongWorkspaceRuntimeContext;
  profile: LongAgentProfile;
  sessionId: string;
  runId: string;
  writeApprovalMode?: AgentWriteApprovalMode;
  autoApproveCrossStageOperations?: boolean;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  queryMaterials?: MaterialQueryRunner | undefined;
  executor?: LongCommandExecutor;
  requestUserInput?: AgentUserInputRequester;
  includeAskUserQuestion?: boolean;
  sharedState?: LongWorkspaceToolSharedState;
}

/**
 * The unified long-form tool surface: five CRUD tools over every stage, plus
 * the material, skill and ledger-commit tools.
 */
export function buildLongWorkspaceTools(
  input: BuildLongWorkspaceToolsInput
): AgentTool[] {
  const ctx = createLongToolContext(input);
  const tools: AgentTool[] = [
    buildQueryLinkedMaterialEntriesTool(input),
    buildLoadSkillTool(input)
  ];
  if (input.includeAskUserQuestion !== false) {
    tools.push(buildAskUserQuestionTool(ctx));
  }
  if (ctx.capabilities.has("query_structure")) {
    tools.push(buildListTool(ctx), buildReadTool(ctx));
  }
  if (ctx.writableRoots.size > 0) {
    tools.push(buildCreateTool(ctx), buildEditTool(ctx), buildDeleteTool(ctx));
  }
  if (ctx.capabilities.has("commit_ledger")) {
    tools.push(buildLedgerCommitTool(ctx));
  }
  return tools;
}

export { isLongAgentToolDetails } from "./tool-details";
export { createLongWorkspaceToolSharedState } from "./proposal-overlay";
export type { LongWorkspaceToolSharedState } from "./proposal-overlay";
export type {
  LongReadDocumentResult,
  LongSearchResult
} from "@deepwrite/contracts";
