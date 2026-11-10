import {
  createShortWorkspaceContentRevision,
  type LibraryStructureProposalEventEnvelope
} from "@deepwrite/contracts/renderer";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import type { AgentEditProposal } from "../../types/conversation";
import type { AgentConversationController } from "../useAgentConversation";
import { buildAgentTextDiff } from "../../utils/agentTextDiff";
import { formatError } from "../../i18n/errors";

export function stageLibraryStructureProposal(
  context: ProposalCoordinatorContext,
  event: LibraryStructureProposalEventEnvelope
) {
  if (!context.editor.rememberWorkspaceMutationEvent(event.id)) return;
  const payload = event.payload;
  const conversation = context.conversations
    .all()
    .find((item) => item.acceptsRunEvent(payload.sessionId, payload.runId));
  if (!conversation) return;
  const id = `library-structure:${payload.plan.requestId}`;
  const existing = conversation.getEditProposal(payload.runId, id);
  if (
    existing &&
    ["accepted", "accepting", "rejected"].includes(existing.status)
  ) {
    conversation.markToolConflict(
      payload.runId,
      payload.toolCallId,
      "此轮整理已审阅，请在下一轮继续。"
    );
    return;
  }
  const text = payload.plan.summary;
  const diff = buildAgentTextDiff("", text);
  conversation.upsertEditProposal(payload.runId, {
    id,
    runId: payload.runId,
    workspaceId: `library:${payload.plan.domain}`,
    stageId: "library",
    documentId: id,
    title: payload.plan.domain === "material" ? "整理素材库" : "整理技能库",
    summary: text.slice(0, 1000),
    proposedText: text,
    baseRevision: createShortWorkspaceContentRevision(""),
    proposedRevision: createShortWorkspaceContentRevision(text),
    approvalMode: "request-approval",
    status: "pending",
    additions: diff.additions,
    deletions: diff.deletions,
    hunks: diff.hunks,
    toolCallIds: [
      ...new Set([...(existing?.toolCallIds ?? []), payload.toolCallId])
    ],
    createdAt: existing?.createdAt ?? event.timestamp,
    updatedAt: event.timestamp,
    libraryStructureTarget: payload.plan
  });
}

export async function acceptLibraryStructureProposal(
  context: ProposalCoordinatorContext,
  conversation: AgentConversationController,
  proposal: AgentEditProposal
) {
  const plan = proposal.libraryStructureTarget;
  const api = context.api();
  if (!plan || !api) return;
  try {
    const dirty = context.editor.liveDocuments.value.some(
      (document) =>
        document.domain === plan.domain &&
        context.editor.drafts.value[document.id]?.dirty
    );
    if (dirty)
      throw new Error("此领域仍有未保存的编辑，请先保存，再重新审阅整理提案。");
    if (
      conversation
        .listEditProposals(proposal.runId)
        .some(
          (item) =>
            item.libraryTarget?.domain === plan.domain &&
            ["pending", "accepting", "error"].includes(item.status)
        )
    )
      throw new Error("请先处理本轮正文修改提案，再重新生成整理提案。");
    conversation.updateEditProposal(proposal.runId, proposal.id, {
      status: "accepting"
    });
    await api.catalog.applyLibraryStructure(plan);
    conversation.updateEditProposal(proposal.runId, proposal.id, {
      status: "accepted",
      proposedText: undefined,
      statusMessage:
        "整理已保存；移除的库保留本地文件，删除的条目及其正文文件无法恢复。"
    });
    try {
      await context.catalog.loadSnapshot();
    } catch (error) {
      context.notifications.error(
        formatError(error, "整理已保存，但列表刷新失败，请重新加载。")
      );
    }
  } catch (error) {
    const message = formatError(error, "整理未完成，请刷新后重新审阅。");
    conversation.updateEditProposal(proposal.runId, proposal.id, {
      status: "error",
      statusMessage: message
    });
    context.notifications.error(message);
  }
}
