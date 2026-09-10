import { type AgentWriteApprovalMode } from "@deepwrite/contracts";
import {
  type BuildLibraryAgentToolsInput,
  type MutableLibraryEntry,
  type LibraryAgentToolDetails,
  type LibraryDomain,
  type MutableLibraryOverview
} from "./types";
import { type AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  libraryProjectRevision,
  workspaceDomain,
  libraryId,
  libraryTitle
} from "./workspace";
import { textResult } from "./shared";

export function approvalSummary(
  summary: string,
  approvalMode: AgentWriteApprovalMode | undefined
): string {
  return approvalMode === "auto-approve"
    ? summary.replace(
        "，等待用户审阅。",
        "，已提交实时自动保存队列；以审批卡的落盘状态为准。"
      )
    : summary;
}

export function mutationResult(
  input: BuildLibraryAgentToolsInput,
  operation: "create" | "edit",
  entry: MutableLibraryEntry,
  baseRevision: string,
  summary: string
): AgentToolResult<LibraryAgentToolDetails> {
  const finalizedSummary = approvalSummary(summary, input.writeApprovalMode);
  const projectRevision = libraryProjectRevision(input.workspace);
  const common = {
    kind: "library-entry-mutation",
    domain: workspaceDomain(input.workspace),
    libraryId: libraryId(input.workspace),
    stageId: entry.stageId,
    title: entry.title,
    text: entry.content,
    baseRevision,
    ...(projectRevision === undefined
      ? {}
      : { baseProjectRevision: projectRevision }),
    summary: finalizedSummary
  } as const;
  return operation === "create"
    ? textResult(finalizedSummary, {
        ...common,
        operation,
        ...(input.sharedState ? { creationId: entry.documentId } : {})
      })
    : textResult(finalizedSummary, {
        ...common,
        operation,
        entryId: entry.entryId,
        documentId: entry.documentId
      });
}

export function overviewMutationResult(
  input: BuildLibraryAgentToolsInput,
  domain: LibraryDomain,
  overview: MutableLibraryOverview,
  baseRevision: string,
  summary: string
): AgentToolResult<LibraryAgentToolDetails> {
  const finalizedSummary = approvalSummary(summary, input.writeApprovalMode);
  const projectRevision = libraryProjectRevision(input.workspace);
  return textResult(finalizedSummary, {
    kind: "library-overview-mutation",
    operation: "edit-overview",
    domain,
    libraryId: libraryId(input.workspace),
    documentId: overview.documentId,
    title: `${libraryTitle(input.workspace)} · ${domain === "skill" ? "库说明" : "库介绍"}`,
    text: overview.content,
    baseRevision,
    ...(projectRevision === undefined
      ? {}
      : { baseProjectRevision: projectRevision }),
    summary: finalizedSummary
  });
}
