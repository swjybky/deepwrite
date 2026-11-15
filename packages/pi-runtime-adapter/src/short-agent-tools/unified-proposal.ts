import { SHORT_WORKSPACE_FILE_MAX_CHARACTERS } from "@deepwrite/contracts";
import { draftBodyFeedback } from "./draft-feedback";
import { trackWritingMutation } from "./settlement";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { appendWritingContentCounts } from "../writing-content-counts";
import { AUTO_APPROVE_PROPOSAL_SUBMITTED } from "../write-approval";
import {
  recordUpdatedReadEvidence,
  type ShortUnifiedReadState
} from "./unified-read-tool";
import {
  textResult,
  type BuildWritingWorkspaceToolsInput,
  type ShortWorkspaceToolDetails,
  type ShortWorkspaceToolSharedState
} from "./shared";
import {
  updateShortUnifiedTarget,
  type ShortUnifiedTarget
} from "./unified-target";

/** Agent-facing tool result; the card keeps the plain change summary. */
export function shortProposalSummary(
  input: BuildWritingWorkspaceToolsInput,
  summary: string
): string {
  if (input.writeApprovalMode !== "auto-approve") return summary;
  if (input.promptLocale === "en-US")
    return `${summary}. Submitted for automatic saving.`;
  return summary.includes("等待用户审阅")
    ? summary.replace(
        /，?等待用户审阅。?/u,
        `，${AUTO_APPROVE_PROPOSAL_SUBMITTED}`
      )
    : `${summary.replace(/[。；]$/u, "")}；${AUTO_APPROVE_PROPOSAL_SUBMITTED}`;
}

export function unchanged(input: BuildWritingWorkspaceToolsInput) {
  return textResult(
    input.promptLocale === "en-US"
      ? "Not changed: the requested value already matches."
      : "未修改：目标已是所要求的内容或状态。"
  );
}

export function formShortContentProposal(
  input: BuildWritingWorkspaceToolsInput,
  sharedState: ShortWorkspaceToolSharedState,
  readState: ShortUnifiedReadState,
  target: ShortUnifiedTarget,
  content: string,
  rawSummary: string
): AgentToolResult<ShortWorkspaceToolDetails> {
  if (content === target.content) return unchanged(input);
  if (content.length > SHORT_WORKSPACE_FILE_MAX_CHARACTERS)
    throw new Error(
      input.promptLocale === "en-US"
        ? "The resulting document exceeds the file size limit."
        : "修改后的文档超过单文件长度上限。"
    );
  return trackWritingMutation(input, sharedState, () => {
    const summary = rawSummary.trim();
    const baseRevision = target.revision;
    const revision = updateShortUnifiedTarget(
      input,
      sharedState,
      target,
      content
    );
    recordUpdatedReadEvidence(readState, target, content, revision);
    const message = appendWritingContentCounts(
      shortProposalSummary(input, summary),
      [{ title: target.title, id: target.documentId, content }],
      input.promptLocale
    );
    if (target.kind === "character_overview" || target.kind === "plot_stage") {
      return textResult(message, {
        kind: "workspace-editor-mutation",
        workspaceId: input.workspace.id,
        stageId: target.stageId,
        text: content,
        baseRevision,
        summary
      });
    }
    if (target.kind === "character") {
      return textResult(message, {
        kind: "workspace-character-file-mutation",
        workspaceId: input.workspace.id,
        stageId: "character_design",
        documentId: target.documentId,
        ...(target.itemId ? { itemId: target.itemId } : {}),
        text: content,
        baseRevision,
        summary
      });
    }
    const feedback =
      target.fileKind === "body"
        ? draftBodyFeedback(
            input,
            content,
            sharedState.expertSections.get(target.sectionId!)!
              .wordCountRequirement
          )
        : "";
    return textResult([message, feedback].filter(Boolean).join("\n"), {
      kind: "workspace-expert-draft-file-mutation",
      workspaceId: input.workspace.id,
      stageId: "draft",
      documentId: target.documentId,
      sectionId: target.sectionId!,
      fileKind: target.fileKind!,
      text: content,
      baseRevision,
      summary
    });
  });
}
